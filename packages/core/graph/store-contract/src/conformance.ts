import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import type { GraphStoreClient } from "./contract.ts";
import { everyFieldModel, queryModel } from "./fixtures.ts";
import type { BoundItems, StoreChange } from "./schema.ts";

/** What the conformance kit needs from an adapter's test. */
export interface GraphStoreConformanceOptions {
  /** A name for the `describe` block, such as the adapter and transport under test. */
  readonly name: string;
  /**
   * Makes a client for a store with no models in it. Called once per test, so every test starts empty and any transport can be used, in process or over a link. `close` is called when the test ends.
   */
  readonly createClient: () => Promise<{
    readonly client: GraphStoreClient;
    readonly close: () => Promise<void>;
  }>;
}

/** Runs a test body against a fresh client and closes it afterwards, pass or fail. */
const withClient =
  (
    options: GraphStoreConformanceOptions,
    body: (client: GraphStoreClient) => Promise<void>,
  ) =>
  async (): Promise<void> => {
    const { client, close } = await options.createClient();
    try {
      await body(client);
    } finally {
      await close();
    }
  };

/** The settled error of a call that must fail, so its code and data can be asserted. */
const failureOf = async (
  call: Readonly<Promise<unknown>>,
): Promise<unknown> => {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to fail");
};

/** A two-step model whose only transition can be broken by an upsert. */
const pairModel: Model<OpenIds> = {
  participants: [{ id: "team", label: "Team", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "plan", label: "Plan", actor: "team" },
    { kind: "activity", id: "build", label: "Build", actor: "team" },
  ],
  transitions: [{ id: "plan-build", source: "plan", target: "build" }],
  fragments: [],
  projections: [],
};

/** Items as a source would send them: one new repository participant, two issues, one replacing an existing activity, and a dependency. */
const issueItems: BoundItems = {
  participants: [
    { id: "github:org/repo", label: "org/repo", kind: "system" },
    { id: "team", label: "Platform team", kind: "role" },
  ],
  activities: [
    {
      kind: "activity",
      id: "github:org/repo#1",
      label: "Design the schema",
      actor: "github:org/repo",
      source: "github:org/repo#1",
    },
    {
      kind: "activity",
      id: "github:org/repo#2",
      label: "Write the migration",
      actor: "team",
      source: "github:org/repo#2",
    },
  ],
  transitions: [
    { id: "dep-1-2", source: "github:org/repo#1", target: "github:org/repo#2" },
  ],
  overlay: { "github:org/repo#1": "done" },
};

/** Reads a subscription up to and including the first event `last` accepts, then stops it. */
const takeUntil = async (
  events: Readonly<AsyncIterable<StoreChange>>,
  last: (change: StoreChange) => boolean,
): Promise<readonly StoreChange[]> => {
  const received: StoreChange[] = [];
  for await (const event of events) {
    received.push(event);
    if (last(event)) {
      break;
    }
  }

  return received;
};

/** Reads the first event of a subscription, then stops it. */
const firstOf = async (
  events: Readonly<AsyncIterable<StoreChange>>,
): Promise<readonly StoreChange[]> => takeUntil(events, () => true);

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
      withClient(options, async (client) => {
        await expect(client.v1.models.list()).resolves.toEqual([]);
      }),
    );

    test(
      "a saved model loads back unchanged, every field and order kept",
      withClient(options, async (client) => {
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
        });
      }),
    );

    test(
      "loading a model that was never saved is NOT_FOUND",
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
        });
      }),
    );

    test(
      "an overlay sets the elements it names and leaves the rest",
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
        });
      }),
    );

    test(
      "upserting replaces records with the same id in place and appends the rest",
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
        });
      }),
    );

    test(
      "a bound activity whose id is not its source is refused before it reaches the store",
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      "a query about an element the model lacks is NOT_FOUND naming it",
      withClient(options, async (client) => {
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

    test(
      "a write whose signal has already fired is refused and changes nothing",
      withClient(options, async (client) => {
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
      withClient(options, async (client) => {
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
      "a subscriber that names a revision the model has moved past is told it missed changes",
      withClient(options, async (client) => {
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
