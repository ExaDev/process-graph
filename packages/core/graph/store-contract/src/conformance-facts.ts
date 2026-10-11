import {
  deriveStatuses,
  emptyFactRecord,
  factsFrom,
} from "@exadev/process-graph-domain";
import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import {
  type ClientFactory,
  failureOf,
  pairModel,
  takeUntil,
  withClient,
} from "./conformance-support.ts";

/**
 * A model whose statuses depend on facts: `build` consumes `spec`, an input no activity produces, and the decision `approve` takes `ship` only when the named fact `approved` is true.
 */
const factsModel: Model<OpenIds> = {
  participants: [{ id: "team", label: "Team", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [
    { id: "spec", name: "Specification" },
    { id: "bundle", name: "Bundle", deliverable: true },
  ],
  elements: [
    {
      kind: "activity",
      id: "build",
      label: "Build",
      actor: "team",
      consumes: ["spec"],
      produces: ["bundle"],
    },
    { kind: "decision", id: "approve", label: "Approved?", actor: "team" },
    { kind: "activity", id: "ship", label: "Ship", actor: "team" },
  ],
  transitions: [
    { id: "build-approve", source: "build", target: "approve" },
    {
      id: "approve-ship",
      source: "approve",
      target: "ship",
      condition: {
        kind: "compare",
        op: "eq",
        left: { kind: "reference", key: "approved" },
        right: { kind: "booleanLiteral", value: true },
      },
    },
  ],
  fragments: [],
  projections: [],
};

/** A value of every kind a fact can hold, so a store that loses a kind or a field of one fails the round trip. */
const everyKindOfValue = {
  approved: { kind: "boolean", value: true },
  budget: { kind: "number", value: 2.5, unit: { m: 1, s: -1 } },
  region: { kind: "text", value: "eu-west \u{1f600}" },
  due: { kind: "instant", value: "2026-10-11T09:00:00Z" },
  window: { kind: "duration", value: 3, unit: "d" },
  phase: { kind: "complex", re: 1, im: -0.5 },
} as const;

/**
 * The facts' share of the conformance kit: what `facts.set` and `facts.clear` record beside a model, how other writes keep the record consistent, how subscribers hear of it, and that the record read back drives graph-domain's reasoning. `graphStoreConformance` runs it inside its own `describe` block.
 * @param createClient - Makes a client for an empty store under test.
 */
export const factConformance = (createClient: ClientFactory): void => {
  describe("facts", () => {
    test(
      "a model starts with an empty fact record, read alone or with the model",
      withClient(createClient, async (client) => {
        const { revision } = await client.v1.models.save({
          modelId: "release",
          model: factsModel,
        });

        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toStrictEqual({
          modelId: "release",
          revision,
          facts: { artefacts: {}, values: {} },
        });
        await expect(
          client.v1.models.load({ modelId: "release" }),
        ).resolves.toMatchObject({ facts: emptyFactRecord });
      }),
    );

    test(
      "set facts read back exactly, every value kind kept, and each set merges by name",
      withClient(createClient, async (client) => {
        const saved = await client.v1.models.save({
          modelId: "release",
          model: factsModel,
        });
        const first = await client.v1.facts.set({
          modelId: "release",
          facts: {
            artefacts: { spec: false, bundle: true },
            values: everyKindOfValue,
          },
        });
        const second = await client.v1.facts.set({
          modelId: "release",
          facts: {
            artefacts: { spec: true },
            values: { approved: { kind: "boolean", value: false } },
          },
        });

        expect(first.revision).toBeGreaterThan(saved.revision);
        expect(second.revision).toBeGreaterThan(first.revision);
        const expected = {
          artefacts: { spec: true, bundle: true },
          values: {
            ...everyKindOfValue,
            approved: { kind: "boolean", value: false },
          },
        };
        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toStrictEqual({
          modelId: "release",
          revision: second.revision,
          facts: expected,
        });
        await expect(
          client.v1.models.load({ modelId: "release" }),
        ).resolves.toStrictEqual({
          modelId: "release",
          revision: second.revision,
          model: factsModel,
          overlay: {},
          facts: expected,
        });
      }),
    );

    test(
      "a fact about an artefact the model does not declare is rejected whole",
      withClient(createClient, async (client) => {
        const { revision } = await client.v1.models.save({
          modelId: "release",
          model: factsModel,
        });

        await expect(
          failureOf(
            client.v1.facts.set({
              modelId: "release",
              facts: {
                artefacts: { spec: true, invoice: true },
                values: { approved: { kind: "boolean", value: true } },
              },
            }),
          ),
        ).resolves.toMatchObject({
          code: "UNPROCESSABLE_CONTENT",
          data: {
            issues: [
              {
                code: "unknown-reference",
                message: 'facts refer to unknown artefact id "invoice"',
              },
            ],
          },
        });
        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toStrictEqual({
          modelId: "release",
          revision,
          facts: { artefacts: {}, values: {} },
        });
      }),
    );

    test(
      "reading, setting or clearing the facts of a model that does not exist is NOT_FOUND",
      withClient(createClient, async (client) => {
        await expect(
          failureOf(client.v1.facts.read({ modelId: "missing" })),
        ).resolves.toMatchObject({
          code: "NOT_FOUND",
          data: { modelId: "missing" },
        });
        await expect(
          failureOf(
            client.v1.facts.set({
              modelId: "missing",
              facts: { values: { approved: { kind: "boolean", value: true } } },
            }),
          ),
        ).resolves.toMatchObject({
          code: "NOT_FOUND",
          data: { modelId: "missing" },
        });
        await expect(
          failureOf(
            client.v1.facts.clear({ modelId: "missing", facts: { all: true } }),
          ),
        ).resolves.toMatchObject({
          code: "NOT_FOUND",
          data: { modelId: "missing" },
        });
        await expect(client.v1.models.list()).resolves.toEqual([]);
      }),
    );

    test(
      "clearing forgets the named facts, or with all, the whole record",
      withClient(createClient, async (client) => {
        await client.v1.models.save({ modelId: "release", model: factsModel });
        await client.v1.facts.set({
          modelId: "release",
          facts: {
            artefacts: { spec: true, bundle: false },
            values: everyKindOfValue,
          },
        });
        const named = await client.v1.facts.clear({
          modelId: "release",
          facts: { artefacts: ["spec", "never-set"], values: ["approved"] },
        });

        const kept = Object.fromEntries(
          Object.entries(everyKindOfValue).filter(
            ([name]) => name !== "approved",
          ),
        );
        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toStrictEqual({
          modelId: "release",
          revision: named.revision,
          facts: { artefacts: { bundle: false }, values: kept },
        });

        const all = await client.v1.facts.clear({
          modelId: "release",
          facts: { all: true },
        });

        expect(all.revision).toBeGreaterThan(named.revision);
        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toStrictEqual({
          modelId: "release",
          revision: all.revision,
          facts: { artefacts: {}, values: {} },
        });
      }),
    );

    test(
      "a save keeps named facts and drops facts about artefacts the new model no longer declares; overlay and items writes keep them all",
      withClient(createClient, async (client) => {
        await client.v1.models.save({ modelId: "release", model: factsModel });
        await client.v1.facts.set({
          modelId: "release",
          facts: {
            artefacts: { spec: true, bundle: false },
            values: { approved: { kind: "boolean", value: true } },
          },
        });
        await client.v1.overlay.set({
          modelId: "release",
          overlay: { build: "done" },
        });

        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toMatchObject({
          facts: {
            artefacts: { spec: true, bundle: false },
            values: { approved: { kind: "boolean", value: true } },
          },
        });

        await client.v1.models.save({
          modelId: "release",
          model: {
            ...factsModel,
            artefacts: factsModel.artefacts.filter(({ id }) => id === "spec"),
            elements: factsModel.elements.map((element) =>
              element.kind === "activity" && element.id === "build"
                ? { ...element, produces: [] }
                : element,
            ),
          },
        });

        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toMatchObject({
          facts: {
            artefacts: { spec: true },
            values: { approved: { kind: "boolean", value: true } },
          },
        });
      }),
    );

    test(
      "a model deleted and saved again starts with no facts",
      withClient(createClient, async (client) => {
        await client.v1.models.save({ modelId: "release", model: factsModel });
        await client.v1.facts.set({
          modelId: "release",
          facts: {
            artefacts: { spec: true },
            values: { approved: { kind: "boolean", value: true } },
          },
        });
        await client.v1.models.delete({ modelId: "release" });
        await client.v1.models.save({ modelId: "release", model: factsModel });

        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toMatchObject({ facts: { artefacts: {}, values: {} } });
      }),
    );

    test(
      "a facts write whose signal has already fired is refused and changes nothing",
      withClient(createClient, async (client) => {
        const { revision } = await client.v1.models.save({
          modelId: "release",
          model: factsModel,
        });
        const controller = new AbortController();
        controller.abort();

        await expect(
          client.v1.facts.set(
            { modelId: "release", facts: { artefacts: { spec: true } } },
            { signal: controller.signal },
          ),
        ).rejects.toThrow();
        await expect(
          client.v1.facts.read({ modelId: "release" }),
        ).resolves.toStrictEqual({
          modelId: "release",
          revision,
          facts: { artefacts: {}, values: {} },
        });
      }),
    );

    test(
      "every subscriber to the model hears each facts write, and reads the new facts back",
      withClient(createClient, async (client) => {
        await client.v1.models.save({ modelId: "release", model: factsModel });
        const first = takeUntil(
          await client.v1.changes({ modelId: "release" }),
          ({ kind }) => kind === "deleted",
        );
        const second = takeUntil(
          await client.v1.changes({ modelId: "release" }),
          ({ kind }) => kind === "deleted",
        );

        const set = await client.v1.facts.set({
          modelId: "release",
          facts: { artefacts: { spec: true } },
        });
        const cleared = await client.v1.facts.clear({
          modelId: "release",
          facts: { artefacts: ["spec"] },
        });
        const deleted = await client.v1.models.delete({ modelId: "release" });
        if (!deleted.deleted) {
          throw new Error("the model was saved, so the delete removes it");
        }
        const expected = [
          { modelId: "release", kind: "facts", revision: set.revision },
          { modelId: "release", kind: "facts", revision: cleared.revision },
          { modelId: "release", kind: "deleted", revision: deleted.revision },
        ];

        await expect(first).resolves.toEqual(expected);
        await expect(second).resolves.toEqual(expected);
      }),
    );

    test(
      "the facts read back drive the reasoning: an input set provided unblocks its consumer, and a stored fact picks the branch",
      withClient(createClient, async (client) => {
        await client.v1.models.save({ modelId: "release", model: factsModel });
        const statuses = async () => {
          const { model, overlay, facts } = await client.v1.models.load({
            modelId: "release",
          });

          return deriveStatuses(model, overlay, factsFrom(facts));
        };

        expect((await statuses()).get("build")).toBe("blocked");

        await client.v1.facts.set({
          modelId: "release",
          facts: { artefacts: { spec: true } },
        });
        await client.v1.overlay.set({
          modelId: "release",
          overlay: { build: "done" },
        });

        expect((await statuses()).get("ship")).toBe("unknown");

        await client.v1.facts.set({
          modelId: "release",
          facts: { values: { approved: { kind: "boolean", value: false } } },
        });

        expect((await statuses()).get("ship")).toBe("skipped");

        await client.v1.facts.set({
          modelId: "release",
          facts: { values: { approved: { kind: "boolean", value: true } } },
        });

        expect((await statuses()).get("ship")).toBe("ready");
      }),
    );

    test(
      "facts are kept per model",
      withClient(createClient, async (client) => {
        await client.v1.models.save({ modelId: "release", model: factsModel });
        await client.v1.models.save({ modelId: "pair", model: pairModel });
        await client.v1.facts.set({
          modelId: "release",
          facts: { values: { approved: { kind: "boolean", value: true } } },
        });

        await expect(
          client.v1.facts.read({ modelId: "pair" }),
        ).resolves.toMatchObject({ facts: { artefacts: {}, values: {} } });
      }),
    );
  });
};
