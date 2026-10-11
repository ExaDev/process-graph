import { describe, expect, test } from "vitest";
import {
  type ClientFactory,
  failureOf,
  hierarchyItems,
  withClient,
} from "./conformance-support.ts";

/**
 * The relations' share of the conformance kit: what `items.upsert` stores beside a model, how writes keep it consistent, and the hierarchy queries over `child-of`. `graphStoreConformance` runs it inside its own `describe` block.
 * @param createClient - Makes a client for an empty store under test.
 */
export const relationConformance = (createClient: ClientFactory): void => {
  describe("relations", () => {
    test(
      "relations from items are kept beside the model, each distinct one once, in the order first stored",
      withClient(createClient, async (client) => {
        const [first, second, third, ...rest] = hierarchyItems.relations ?? [];
        if (
          first === undefined ||
          second === undefined ||
          third === undefined
        ) {
          throw new Error(
            "the hierarchy fixture holds at least three relations",
          );
        }
        await client.v1.items.upsert({
          modelId: "work",
          items: { ...hierarchyItems, relations: [first, second] },
        });
        await client.v1.items.upsert({
          modelId: "work",
          items: {
            ...hierarchyItems,
            relations: [second, third, ...rest, third],
          },
        });

        await expect(
          client.v1.relations.list({ modelId: "work" }),
        ).resolves.toEqual({ relations: [first, second, third, ...rest] });
      }),
    );

    test(
      "a relation naming what the model does not declare, or an end of the wrong kind, is rejected whole",
      withClient(createClient, async (client) => {
        const { revision } = await client.v1.items.upsert({
          modelId: "work",
          items: hierarchyItems,
        });

        await expect(
          failureOf(
            client.v1.items.upsert({
              modelId: "work",
              items: {
                ...hierarchyItems,
                relations: [
                  {
                    kind: "child-of",
                    from: "github:org/repo#2",
                    to: "github:org/repo#99",
                  },
                  {
                    kind: "assigned-to",
                    from: "github:org/repo#2",
                    to: "github:org/repo#3",
                  },
                ],
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
                  'child-of relation to refers to unknown element id "github:org/repo#99"',
              },
              {
                code: "unknown-reference",
                message:
                  'assigned-to relation to refers to unknown participant id "github:org/repo#3"',
              },
            ],
          },
        });
        await expect(
          client.v1.relations.list({ modelId: "work" }),
        ).resolves.toEqual({ relations: hierarchyItems.relations });
        await expect(client.v1.models.list()).resolves.toEqual([
          { modelId: "work", revision },
        ]);
      }),
    );

    test(
      "run state leaves relations alone; saving a model keeps only the relations of what it still declares; deleting it removes them",
      withClient(createClient, async (client) => {
        await client.v1.items.upsert({
          modelId: "work",
          items: hierarchyItems,
        });
        await client.v1.overlay.set({
          modelId: "work",
          overlay: { "github:org/repo#4": "done" },
        });
        await expect(
          client.v1.relations.list({ modelId: "work" }),
        ).resolves.toEqual({ relations: hierarchyItems.relations });

        const { model } = await client.v1.models.load({ modelId: "work" });
        await client.v1.models.save({
          modelId: "work",
          model: {
            ...model,
            participants: model.participants.filter(
              ({ id }) => id !== "github:@ada",
            ),
            elements: model.elements.filter(
              ({ id }) => id !== "github:org/repo#4",
            ),
          },
        });
        await expect(
          client.v1.relations.list({ modelId: "work" }),
        ).resolves.toEqual({
          relations: (hierarchyItems.relations ?? []).filter(
            ({ from, to }) =>
              from !== "github:org/repo#4" && to !== "github:@ada",
          ),
        });

        await client.v1.models.delete({ modelId: "work" });
        await client.v1.items.upsert({
          modelId: "work",
          items: { ...hierarchyItems, relations: [] },
        });
        await expect(
          client.v1.relations.list({ modelId: "work" }),
        ).resolves.toEqual({ relations: [] });
      }),
    );

    test(
      "children, descendants and ancestors follow child-of relations only, nearest first, in model order",
      withClient(createClient, async (client) => {
        await client.v1.items.upsert({
          modelId: "work",
          items: hierarchyItems,
        });
        const ask = { modelId: "work", element: "github:org/repo#1" };

        await expect(client.v1.query.children(ask)).resolves.toEqual({
          children: ["github:org/repo#2", "github:org/repo#3"],
        });
        await expect(client.v1.query.descendants(ask)).resolves.toEqual({
          descendants: [
            { element: "github:org/repo#2", distance: 1 },
            { element: "github:org/repo#3", distance: 1 },
            { element: "github:org/repo#4", distance: 2 },
          ],
        });
        await expect(
          client.v1.query.ancestors({
            modelId: "work",
            element: "github:org/repo#4",
          }),
        ).resolves.toEqual({
          ancestors: [
            { element: "github:org/repo#2", distance: 1 },
            { element: "github:org/repo#1", distance: 2 },
          ],
        });
        await expect(client.v1.query.ancestors(ask)).resolves.toEqual({
          ancestors: [],
        });
        await expect(
          client.v1.query.children({
            modelId: "work",
            element: "github:org/repo#4",
          }),
        ).resolves.toEqual({ children: [] });
      }),
    );

    test(
      "hierarchy walks terminate on a cycle of child-of relations, never reporting the element asked about",
      withClient(createClient, async (client) => {
        await client.v1.items.upsert({
          modelId: "work",
          items: hierarchyItems,
        });
        const ask = { modelId: "work", element: "github:org/repo#5" };

        await expect(client.v1.query.descendants(ask)).resolves.toEqual({
          descendants: [{ element: "github:org/repo#6", distance: 1 }],
        });
        await expect(client.v1.query.ancestors(ask)).resolves.toEqual({
          ancestors: [{ element: "github:org/repo#6", distance: 1 }],
        });
        await expect(client.v1.query.children(ask)).resolves.toEqual({
          children: ["github:org/repo#6"],
        });
      }),
    );

    test(
      "relations and hierarchy queries about a missing model or element are NOT_FOUND",
      withClient(createClient, async (client) => {
        await client.v1.items.upsert({
          modelId: "work",
          items: hierarchyItems,
        });

        await expect(
          failureOf(client.v1.relations.list({ modelId: "missing" })),
        ).resolves.toMatchObject({
          code: "NOT_FOUND",
          data: { modelId: "missing" },
        });
        const participant = { modelId: "work", element: "github:@ada" };
        await Promise.all(
          [
            client.v1.query.children(participant),
            client.v1.query.descendants(participant),
            client.v1.query.ancestors(participant),
          ].map(async (query) =>
            expect(failureOf(query)).resolves.toMatchObject({
              code: "NOT_FOUND",
              data: participant,
            }),
          ),
        );
      }),
    );
  });
};
