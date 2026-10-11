import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import { factConformance } from "./conformance-facts.ts";
import { relationConformance } from "./conformance-relations.ts";
import {
  type ClientFactory,
  failureOf,
  withClient,
  firstOf,
  inSequence,
  issueItems,
  pairModel,
  silentLosses,
  takeUntil,
} from "./conformance-support.ts";
import { defaultSubscriptionCapacity } from "./feed.ts";

/**
 * A model that uses every field the model schema has, each optional field present on some record and absent on another, so a store that drops, renames or reorders anything fails the round trip.
 */
export const everyFieldModel: Model<OpenIds> = {
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
  ],
  events: [
    { id: "placed", name: "Order placed", payload: { total: "number" } },
    { id: "paid", name: "Payment received" },
  ],
  actions: [
    { id: "notify", name: "Notify customer" },
    { id: "log", name: "Write audit log" },
  ],
  artefacts: [
    { id: "basket", name: "Basket" },
    { id: "invoice", name: "Invoice", deliverable: true },
    { id: "receipt", name: "Receipt", deliverable: false },
  ],
  elements: [
    { kind: "pseudo", id: "start", role: "initial" },
    {
      kind: "activity",
      id: "github:shop/orders#1",
      label: "Place order",
      actor: "customer",
      action: "notify",
      source: "github:shop/orders#1",
      affects: ["order"],
      consumes: ["basket"],
      produces: ["invoice"],
      extensions: { bpmn: { pool: "Customer", lane: 1, marker: null } },
    },
    { kind: "decision", id: "approve", label: "Approve?", actor: "shop" },
    {
      kind: "state",
      id: "pending",
      label: "Pending",
      parent: "start",
      entry: "log",
      exit: "notify",
    },
    { kind: "state", id: "closed", label: "Closed" },
    {
      kind: "message",
      id: "confirm",
      label: "Confirm",
      from: "shop",
      to: "customer",
      mode: "async",
      event: "paid",
    },
    {
      kind: "message",
      id: "ack",
      label: "Acknowledge",
      from: "customer",
      to: "shop",
      mode: "reply",
    },
    { kind: "activity", id: "ship", label: "Ship" },
    { kind: "pseudo", id: "end", role: "final", parent: "pending" },
  ],
  transitions: [
    { id: "t-start", source: "start", target: "github:shop/orders#1" },
    {
      id: "t-review",
      source: "github:shop/orders#1",
      target: "approve",
      trigger: "placed",
      effect: "log",
    },
    {
      id: "t-yes",
      source: "approve",
      target: "ship",
      guard: "approved",
      condition: {
        kind: "compare",
        op: "eq",
        left: { kind: "reference", key: { $fact: "approved" } },
        right: { kind: "booleanLiteral", value: true },
      },
    },
    { id: "t-no", source: "approve", target: "closed", guard: "rejected" },
    { id: "t-end", source: "ship", target: "end" },
  ],
  fragments: [
    {
      id: "decide",
      operator: "alt",
      operands: [{ guard: "approved", body: ["ship"] }, { body: ["closed"] }],
    },
    { id: "chat", operator: "par", operands: [] },
  ],
  projections: [
    { id: "flow", notation: "flowchart" },
    { id: "lanes", notation: "swimlane" },
    { id: "lifecycle", notation: "stateMachine", subject: "order" },
    { id: "happy", notation: "sequence", scenario: ["t-review", "t-yes"] },
  ],
  views: {
    flowchart: { start: { x: 0, y: 0 }, ship: { x: 120.5, y: -40 } },
    sequence: {},
  },
};

/**
 * A model for the structural queries: a done first step, a chain through a decision whose retry edge loops back, a join waiting on two branches, and an unrelated step.
 *
 * `a` (done) leads to `b`, `b` to `c`, `c` to the decision `d`, which either approves into `e` or retries back to `b` (a loop edge, so it is no dependency). `e` and the independent `x` meet at the join `j`, which leads to `f`.
 */
export const queryModel: Model<OpenIds> = {
  participants: [{ id: "team", label: "Team", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "a", label: "A", actor: "team" },
    { kind: "activity", id: "b", label: "B", actor: "team" },
    { kind: "activity", id: "c", label: "C", actor: "team" },
    { kind: "decision", id: "d", label: "D?" },
    { kind: "activity", id: "e", label: "E", actor: "team" },
    { kind: "activity", id: "x", label: "X", actor: "team" },
    { kind: "pseudo", id: "j", role: "join" },
    { kind: "activity", id: "f", label: "F", actor: "team" },
  ],
  transitions: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
    { id: "cd", source: "c", target: "d" },
    { id: "de", source: "d", target: "e", guard: "approved" },
    { id: "db", source: "d", target: "b", guard: "retry" },
    { id: "ej", source: "e", target: "j" },
    { id: "xj", source: "x", target: "j" },
    { id: "jf", source: "j", target: "f" },
  ],
  fragments: [],
  projections: [],
};

/** What the conformance kit needs from an adapter's test. */
export interface GraphStoreConformanceOptions {
  /** A name for the `describe` block, such as the adapter and transport under test. */
  readonly name: string;
  /**
   * Makes a client for a store with no models in it. Called once per test, so every test starts empty and any transport can be used, in process or over a link. `close` is called when the test ends.
   */
  readonly createClient: ClientFactory;
}

/**
 * The behaviour every `GraphStore` adapter must show, as Vitest tests. Call it at the top level of a test file; every test runs through the oRPC client the options create, so the kit checks the port as consumers see it, transport included.
 * @param options - How to make a client for an empty store under test.
 */
export const graphStoreConformance = (
  options: GraphStoreConformanceOptions,
): void => {
  describe(`GraphStore conformance: ${options.name}`, () => {
    test(
      "a new store lists no models",
      withClient(options.createClient, async (client) => {
        await expect(client.v1.models.list()).resolves.toEqual([]);
      }),
    );

    test(
      "a saved model loads back unchanged, every field and order kept",
      withClient(options.createClient, async (client) => {
        const { revision } = await client.v1.models.save({
          modelId: "orders",
          model: everyFieldModel,
        });

        await expect(
          client.v1.models.load({ modelId: "orders" }),
        ).resolves.toStrictEqual({
          modelId: "orders",
          revision,
          model: everyFieldModel,
          overlay: {},
          facts: { artefacts: {}, values: {} },
        });
      }),
    );

    test(
      "loading a model that was never saved is NOT_FOUND",
      withClient(options.createClient, async (client) => {
        await expect(
          failureOf(client.v1.models.load({ modelId: "missing" })),
        ).resolves.toMatchObject({
          code: "NOT_FOUND",
          data: { modelId: "missing" },
        });
      }),
    );

    test(
      "an invalid model is rejected whole with its issues",
      withClient(options.createClient, async (client) => {
        const duplicated: Model<OpenIds> = {
          ...pairModel,
          elements: [...pairModel.elements, ...pairModel.elements],
        };

        await expect(
          failureOf(
            client.v1.models.save({ modelId: "pair", model: duplicated }),
          ),
        ).resolves.toMatchObject({
          code: "UNPROCESSABLE_CONTENT",
          data: {
            issues: [
              { code: "duplicate-id", message: 'Duplicate element id "plan"' },
              { code: "duplicate-id", message: 'Duplicate element id "build"' },
            ],
          },
        });
        await expect(client.v1.models.list()).resolves.toEqual([]);
      }),
    );

    test(
      "every write takes a later revision, store-wide, and list reports each model's last",
      withClient(options.createClient, async (client) => {
        const first = await client.v1.models.save({
          modelId: "b",
          model: pairModel,
        });
        const second = await client.v1.models.save({
          modelId: "a",
          model: pairModel,
        });
        const third = await client.v1.overlay.set({
          modelId: "b",
          overlay: { plan: "done" },
        });

        expect(second.revision).toBeGreaterThan(first.revision);
        expect(third.revision).toBeGreaterThan(second.revision);
        await expect(client.v1.models.list()).resolves.toEqual([
          { modelId: "a", revision: second.revision },
          { modelId: "b", revision: third.revision },
        ]);
      }),
    );

    test(
      "saving over a model replaces it and drops the run state of elements it no longer declares",
      withClient(options.createClient, async (client) => {
        await client.v1.models.save({ modelId: "pair", model: pairModel });
        await client.v1.overlay.set({
          modelId: "pair",
          overlay: { plan: "done", build: "unknown" },
        });
        const smaller: Model<OpenIds> = {
          ...pairModel,
          elements: pairModel.elements.filter(({ id }) => id === "plan"),
          transitions: [],
        };
        const { revision } = await client.v1.models.save({
          modelId: "pair",
          model: smaller,
        });

        await expect(
          client.v1.models.load({ modelId: "pair" }),
        ).resolves.toStrictEqual({
          modelId: "pair",
          revision,
          model: smaller,
          overlay: { plan: "done" },
          facts: { artefacts: {}, values: {} },
        });
      }),
    );

    test(
      "an overlay sets the elements it names and leaves the rest",
      withClient(options.createClient, async (client) => {
        await client.v1.models.save({ modelId: "pair", model: pairModel });
        await client.v1.overlay.set({
          modelId: "pair",
          overlay: { plan: "open", build: "unknown" },
        });
        const { revision } = await client.v1.overlay.set({
          modelId: "pair",
          overlay: { plan: "done" },
        });

        await expect(
          client.v1.models.load({ modelId: "pair" }),
        ).resolves.toMatchObject({
          revision,
          overlay: { plan: "done", build: "unknown" },
        });
      }),
    );

    test(
      "an overlay naming an element the model lacks is rejected and changes nothing",
      withClient(options.createClient, async (client) => {
        const { revision } = await client.v1.models.save({
          modelId: "pair",
          model: pairModel,
        });

        await expect(
          failureOf(
            client.v1.overlay.set({
              modelId: "pair",
              overlay: { plan: "done", ghost: "done" },
            }),
          ),
        ).resolves.toMatchObject({
          code: "UNPROCESSABLE_CONTENT",
          data: {
            issues: [
              {
                code: "overlay-unknown-element",
                message: 'overlay refers to unknown element id "ghost"',
              },
            ],
          },
        });
        await expect(
          client.v1.models.load({ modelId: "pair" }),
        ).resolves.toMatchObject({ revision, overlay: {} });
      }),
    );

    test(
      "an overlay for a model that does not exist is NOT_FOUND",
      withClient(options.createClient, async (client) => {
        await expect(
          failureOf(
            client.v1.overlay.set({
              modelId: "missing",
              overlay: { plan: "done" },
            }),
          ),
        ).resolves.toMatchObject({
          code: "NOT_FOUND",
          data: { modelId: "missing" },
        });
      }),
    );

    test(
      "deleting removes a model once, and it no longer loads",
      withClient(options.createClient, async (client) => {
        const saved = await client.v1.models.save({
          modelId: "pair",
          model: pairModel,
        });
        const deleted = await client.v1.models.delete({ modelId: "pair" });

        expect(deleted.deleted).toBe(true);
        expect(deleted.deleted && deleted.revision).toBeGreaterThan(
          saved.revision,
        );
        await expect(
          client.v1.models.delete({ modelId: "pair" }),
        ).resolves.toEqual({ deleted: false });
        await expect(
          failureOf(client.v1.models.load({ modelId: "pair" })),
        ).resolves.toMatchObject({ code: "NOT_FOUND" });
      }),
    );

    test(
      "upserting items into a missing model creates it from the items",
      withClient(options.createClient, async (client) => {
        const { revision } = await client.v1.items.upsert({
          modelId: "issues",
          items: issueItems,
        });

        await expect(
          client.v1.models.load({ modelId: "issues" }),
        ).resolves.toStrictEqual({
          modelId: "issues",
          revision,
          model: {
            participants: issueItems.participants,
            events: [],
            actions: [],
            artefacts: [],
            elements: issueItems.activities,
            transitions: issueItems.transitions,
            fragments: [],
            projections: [],
          },
          overlay: issueItems.overlay,
          facts: { artefacts: {}, values: {} },
        });
      }),
    );

    test(
      "upserting replaces records with the same id in place and appends the rest",
      withClient(options.createClient, async (client) => {
        const model: Model<OpenIds> = {
          ...pairModel,
          elements: [
            ...pairModel.elements,
            {
              kind: "activity",
              id: "github:org/repo#1",
              label: "Old title",
              source: "github:org/repo#1",
            },
          ],
        };
        await client.v1.models.save({ modelId: "mixed", model });
        await client.v1.overlay.set({
          modelId: "mixed",
          overlay: { plan: "done" },
        });
        await client.v1.items.upsert({ modelId: "mixed", items: issueItems });

        await expect(
          client.v1.models.load({ modelId: "mixed" }),
        ).resolves.toMatchObject({
          model: {
            participants: [
              { id: "team", label: "Platform team", kind: "role" },
              { id: "github:org/repo", label: "org/repo", kind: "system" },
            ],
            elements: [
              pairModel.elements[0],
              pairModel.elements[1],
              issueItems.activities[0],
              issueItems.activities[1],
            ],
            transitions: [...pairModel.transitions, ...issueItems.transitions],
          },
          overlay: { plan: "done", "github:org/repo#1": "done" },
        });
      }),
    );

    test(
      "an upsert that would break the model is rejected and changes nothing",
      withClient(options.createClient, async (client) => {
        const { revision } = await client.v1.models.save({
          modelId: "pair",
          model: pairModel,
        });

        await expect(
          failureOf(
            client.v1.items.upsert({
              modelId: "pair",
              items: {
                participants: [],
                activities: [],
                transitions: [
                  { id: "dangling", source: "plan", target: "github:x/y#9" },
                ],
                overlay: {},
              },
            }),
          ),
        ).resolves.toMatchObject({
          code: "UNPROCESSABLE_CONTENT",
          data: {
            issues: [
              {
                code: "unknown-reference",
                message:
                  'transition "dangling" target refers to unknown id "github:x/y#9"',
              },
            ],
          },
        });
        await expect(
          client.v1.models.load({ modelId: "pair" }),
        ).resolves.toStrictEqual({
          modelId: "pair",
          revision,
          model: pairModel,
          overlay: {},
          facts: { artefacts: {}, values: {} },
        });
      }),
    );

    test(
      "a bound activity whose id is not its source is refused before it reaches the store",
      withClient(options.createClient, async (client) => {
        await expect(
          failureOf(
            client.v1.items.upsert({
              modelId: "issues",
              items: {
                ...issueItems,
                activities: [
                  {
                    kind: "activity",
                    id: "renamed",
                    label: "Renamed",
                    source: "github:org/repo#1",
                  },
                ],
              },
            }),
          ),
        ).resolves.toMatchObject({ code: "BAD_REQUEST" });
        await expect(client.v1.models.list()).resolves.toEqual([]);
      }),
    );

    test(
      "ready lists open work with nothing unfinished upstream, passing through control elements and loop edges",
      withClient(options.createClient, async (client) => {
        await client.v1.models.save({ modelId: "q", model: queryModel });
        await client.v1.overlay.set({
          modelId: "q",
          overlay: { a: "done" },
        });

        await expect(client.v1.query.ready({ modelId: "q" })).resolves.toEqual({
          elements: ["b", "x"],
        });

        await client.v1.overlay.set({
          modelId: "q",
          overlay: { c: "done", x: "unknown" },
        });

        await expect(client.v1.query.ready({ modelId: "q" })).resolves.toEqual({
          elements: ["b", "e"],
        });
      }),
    );

    test(
      "the blocked chain is the unfinished work upstream, nearest first, stopping at done work",
      withClient(options.createClient, async (client) => {
        await client.v1.models.save({ modelId: "q", model: queryModel });
        await client.v1.overlay.set({
          modelId: "q",
          overlay: { a: "done" },
        });

        await expect(
          client.v1.query.blockedChain({ modelId: "q", element: "f" }),
        ).resolves.toEqual({
          chain: [
            { element: "e", distance: 2 },
            { element: "x", distance: 2 },
            { element: "c", distance: 4 },
            { element: "b", distance: 5 },
          ],
        });
        await expect(
          client.v1.query.blockedChain({ modelId: "q", element: "b" }),
        ).resolves.toEqual({ chain: [] });
        await expect(
          client.v1.query.blockedChain({ modelId: "q", element: "a" }),
        ).resolves.toEqual({ chain: [] });
      }),
    );

    test(
      "impact is the unfinished work downstream, nearest first, whatever the element's own state",
      withClient(options.createClient, async (client) => {
        await client.v1.models.save({ modelId: "q", model: queryModel });
        await client.v1.overlay.set({
          modelId: "q",
          overlay: { a: "done", e: "done" },
        });

        await expect(
          client.v1.query.impact({ modelId: "q", element: "b" }),
        ).resolves.toEqual({ impacted: [{ element: "c", distance: 1 }] });
        await expect(
          client.v1.query.impact({ modelId: "q", element: "a" }),
        ).resolves.toEqual({
          impacted: [
            { element: "b", distance: 1 },
            { element: "c", distance: 2 },
          ],
        });
        await expect(
          client.v1.query.impact({ modelId: "q", element: "x" }),
        ).resolves.toEqual({ impacted: [{ element: "f", distance: 2 }] });
      }),
    );

    test(
      "queries terminate on a cycle no decision closes, and never report the element asked about",
      withClient(options.createClient, async (client) => {
        const cycle: Model<OpenIds> = {
          ...pairModel,
          elements: [
            ...pairModel.elements,
            { kind: "activity", id: "ship", label: "Ship", actor: "team" },
          ],
          transitions: [
            ...pairModel.transitions,
            { id: "build-plan", source: "build", target: "plan" },
            { id: "build-ship", source: "build", target: "ship" },
          ],
        };
        await client.v1.models.save({ modelId: "cycle", model: cycle });

        await expect(
          client.v1.query.blockedChain({ modelId: "cycle", element: "plan" }),
        ).resolves.toEqual({ chain: [{ element: "build", distance: 1 }] });
        await expect(
          client.v1.query.blockedChain({ modelId: "cycle", element: "ship" }),
        ).resolves.toEqual({
          chain: [
            { element: "build", distance: 1 },
            { element: "plan", distance: 2 },
          ],
        });
        await expect(
          client.v1.query.impact({ modelId: "cycle", element: "plan" }),
        ).resolves.toEqual({
          impacted: [
            { element: "build", distance: 1 },
            { element: "ship", distance: 2 },
          ],
        });
        await expect(
          client.v1.query.ready({ modelId: "cycle" }),
        ).resolves.toEqual({ elements: [] });
      }),
    );

    test(
      "a query about an element the model lacks is NOT_FOUND naming it",
      withClient(options.createClient, async (client) => {
        await client.v1.models.save({ modelId: "q", model: queryModel });

        await expect(
          failureOf(client.v1.query.impact({ modelId: "q", element: "ghost" })),
        ).resolves.toMatchObject({
          code: "NOT_FOUND",
          data: { modelId: "q", element: "ghost" },
        });
        await expect(
          failureOf(client.v1.query.ready({ modelId: "missing" })),
        ).resolves.toMatchObject({
          code: "NOT_FOUND",
          data: { modelId: "missing" },
        });
      }),
    );

    relationConformance(options.createClient);

    factConformance(options.createClient);

    test(
      "a write whose signal has already fired is refused and changes nothing",
      withClient(options.createClient, async (client) => {
        const controller = new AbortController();
        controller.abort();

        await expect(
          client.v1.models.save(
            { modelId: "pair", model: pairModel },
            { signal: controller.signal },
          ),
        ).rejects.toThrow();
        await expect(client.v1.models.list()).resolves.toEqual([]);
      }),
    );

    test(
      "a subscriber receives every later change to its model, in order, and none of another's",
      withClient(options.createClient, async (client) => {
        await client.v1.models.save({ modelId: "pair", model: pairModel });
        const events = await client.v1.changes({ modelId: "pair" });
        const received = takeUntil(events, ({ kind }) => kind === "deleted");

        const overlay = await client.v1.overlay.set({
          modelId: "pair",
          overlay: { plan: "done" },
        });
        await client.v1.models.save({ modelId: "other", model: pairModel });
        const items = await client.v1.items.upsert({
          modelId: "pair",
          items: issueItems,
        });
        const saved = await client.v1.models.save({
          modelId: "pair",
          model: pairModel,
        });
        const deleted = await client.v1.models.delete({ modelId: "pair" });

        await expect(received).resolves.toEqual([
          { modelId: "pair", kind: "overlay", revision: overlay.revision },
          { modelId: "pair", kind: "items", revision: items.revision },
          { modelId: "pair", kind: "saved", revision: saved.revision },
          {
            modelId: "pair",
            kind: "deleted",
            revision: deleted.deleted ? deleted.revision : undefined,
          },
        ]);
      }),
    );

    test(
      "a subscriber that stops reading under sustained writes is never left unaware of a change it lost",
      withClient(options.createClient, async (client) => {
        await client.v1.models.save({ modelId: "pair", model: pairModel });
        const events = await client.v1.changes({ modelId: "pair" });
        // More writes than a subscription holds by default, so a store that buffers per subscription has to overflow; the property checked holds for any capacity.
        const burst = await inSequence(
          Array.from(
            {
              length:
                defaultSubscriptionCapacity + defaultSubscriptionCapacity + 1,
            },
            (_, write) => async () =>
              (
                await client.v1.overlay.set({
                  modelId: "pair",
                  overlay: { plan: write % 2 === 0 ? "done" : "open" },
                })
              ).revision,
          ),
        );
        // Reading starts only now; the final write, the only save after subscribing, commits while the subscriber reads, so it must arrive. It is found by its kind because its event can arrive before the write's own reply does.
        const received = takeUntil(events, ({ kind }) => kind === "saved");
        const final = (
          await client.v1.models.save({ modelId: "pair", model: pairModel })
        ).revision;

        expect(silentLosses(await received, [...burst, final])).toEqual([]);
      }),
    );

    test(
      "a subscriber that names a revision the model has moved past is told it missed changes",
      withClient(options.createClient, async (client) => {
        const first = await client.v1.models.save({
          modelId: "pair",
          model: pairModel,
        });
        const second = await client.v1.overlay.set({
          modelId: "pair",
          overlay: { plan: "done" },
        });

        const behind = await client.v1.changes({
          modelId: "pair",
          since: first.revision,
        });
        await expect(firstOf(behind)).resolves.toEqual([
          { modelId: "pair", kind: "missed" },
        ]);

        const current = await client.v1.changes({
          modelId: "pair",
          since: second.revision,
        });
        const next = firstOf(current);
        const third = await client.v1.overlay.set({
          modelId: "pair",
          overlay: { build: "done" },
        });
        await expect(next).resolves.toEqual([
          { modelId: "pair", kind: "overlay", revision: third.revision },
        ]);
      }),
    );
  });
};
