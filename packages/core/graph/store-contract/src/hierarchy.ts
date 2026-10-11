import type { Issue, Model, OpenIds } from "@exadev/process-graph-schema";
import type { Reach, Relation, RelationKind } from "./schema.ts";

/** Which identifier space each end of a relation of each kind names: a sub-task and its parent are elements, an assignee and a containing organisation are participants. */
const endpoints: Readonly<
  Record<RelationKind, { readonly from: Space; readonly to: Space }>
> = {
  "child-of": { from: "element", to: "element" },
  "assigned-to": { from: "element", to: "participant" },
  "part-of": { from: "participant", to: "participant" },
};

type Space = "element" | "participant";

/** The identity of a relation: one relation of a kind between two identifiers, however often it is reported. */
const relationKey = (relation: Readonly<Relation>): string =>
  JSON.stringify([relation.kind, relation.from, relation.to]);

/**
 * Adds relations to a stored list: one already there is kept in its place, and a new one is appended in its incoming order, each distinct relation once.
 * @param current - The stored relations.
 * @param incoming - The relations to add.
 * @returns The merged relations.
 */
export const mergeRelations = (
  current: readonly Relation[],
  incoming: readonly Relation[],
): readonly Relation[] => {
  // A map keeps a key at its first insertion, so a relation already stored stays in its place and a repeat adds nothing.
  const merged = new Map(
    [...current, ...incoming].map((relation) => [
      relationKey(relation),
      relation,
    ]),
  );

  return [...merged.values()];
};

/** The identifiers a model declares in each space a relation can name. */
const spacesOf = (
  model: Model<OpenIds>,
): Readonly<Record<Space, ReadonlySet<string>>> => ({
  element: new Set(model.elements.map(({ id }) => id)),
  participant: new Set(model.participants.map(({ id }) => id)),
});

/**
 * Keeps only the relations both of whose ends the model still declares, in the space their kind names, so replacing a model drops the relations of what it no longer has.
 * @param model - The model the relations are for.
 * @param relations - The relations to narrow.
 * @returns The relations whose ends are both declared.
 */
export const relationsWithin = (
  model: Model<OpenIds>,
  relations: readonly Relation[],
): readonly Relation[] => {
  const spaces = spacesOf(model);

  return relations.filter(
    (relation) =>
      spaces[endpoints[relation.kind].from].has(relation.from) &&
      spaces[endpoints[relation.kind].to].has(relation.to),
  );
};

/**
 * The issues with a model's relations: an end that names nothing the model declares in the space its kind requires is an `unknown-reference`, as an unknown reference anywhere else in a model is.
 * @param model - The model the relations are for.
 * @param relations - The relations to check.
 * @returns One issue per end that names nothing, empty when every end resolves.
 */
export const relationIssues = (
  model: Model<OpenIds>,
  relations: readonly Relation[],
): readonly Issue[] => {
  const spaces = spacesOf(model);

  return relations.flatMap((relation) =>
    (["from", "to"] as const).flatMap((end) => {
      const space = endpoints[relation.kind][end];
      const id = relation[end];

      return spaces[space].has(id)
        ? []
        : [
            {
              code: "unknown-reference" as const,
              message: `${relation.kind} relation ${end} refers to unknown ${space} id "${id}"`,
            },
          ];
    }),
  );
};

/**
 * Orders elements by their position in the model. Every element a hierarchy query reports is the end of a stored `child-of` relation, which `relationIssues` has checked the model declares.
 * @throws Error for an element the model does not declare, which only a store that skipped that check can cause.
 */
const byModelOrder = (
  model: Model<OpenIds>,
): ((left: string, right: string) => number) => {
  const order = new Map(model.elements.map(({ id }, index) => [id, index]));
  const positionOf = (element: string): number => {
    const position = order.get(element);
    if (position === undefined) {
      throw new Error(`No element "${element}" in the model`);
    }

    return position;
  };

  return (left, right) => positionOf(left) - positionOf(right);
};

/** Which way a hierarchy walk goes: from a parent to its children, or from a child to its parents. */
type Direction = "down" | "up";

/**
 * Breadth-first walk along `child-of` relations from `start`, with the fewest steps it takes to reach each element, by that distance and then model order. `start` itself is never reported, so a cycle of `child-of` relations through it ends the walk.
 */
const walk = (
  model: Model<OpenIds>,
  relations: readonly Relation[],
  start: string,
  direction: Direction,
): readonly Reach[] => {
  const next = new Map<string, string[]>();
  for (const { kind, from, to } of relations) {
    if (kind === "child-of") {
      const [key, value] = direction === "down" ? [to, from] : [from, to];
      next.set(key, [...(next.get(key) ?? []), value]);
    }
  }
  const compare = byModelOrder(model);
  const distance = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  for (let depth = 1; frontier.length > 0; depth += 1) {
    const reached = [
      ...new Set(frontier.flatMap((element) => next.get(element) ?? [])),
    ].filter((element) => !distance.has(element));
    for (const element of reached) {
      distance.set(element, depth);
    }
    frontier = reached;
  }
  distance.delete(start);

  return [...distance]
    .map(([element, steps]) => ({ element, distance: steps }))
    .sort(
      (left, right) =>
        left.distance - right.distance || compare(left.element, right.element),
    );
};

/**
 * The direct children of an element: every element related to it by `child-of`.
 * @param model - The model, which declares `element`.
 * @param relations - The model's relations.
 * @param element - The parent.
 * @returns The children, in model order.
 */
export const childrenOf = (
  model: Model<OpenIds>,
  relations: readonly Relation[],
  element: string,
): readonly string[] =>
  [
    ...new Set(
      relations
        .filter(({ kind, to }) => kind === "child-of" && to === element)
        .map(({ from }) => from),
    ),
  ]
    .filter((child) => child !== element)
    .sort(byModelOrder(model));

/**
 * Everything beneath an element: its children, their children and so on, each with the fewest `child-of` steps between them.
 * @param model - The model, which declares `element`.
 * @param relations - The model's relations.
 * @param element - The element at the top.
 * @returns The descendants, by distance and then model order.
 */
export const descendantsOf = (
  model: Model<OpenIds>,
  relations: readonly Relation[],
  element: string,
): readonly Reach[] => walk(model, relations, element, "down");

/**
 * Everything above an element: its parents, their parents and so on, nearest first.
 * @param model - The model, which declares `element`.
 * @param relations - The model's relations.
 * @param element - The element at the bottom.
 * @returns The ancestors, by distance and then model order.
 */
export const ancestorsOf = (
  model: Model<OpenIds>,
  relations: readonly Relation[],
  element: string,
): readonly Reach[] => walk(model, relations, element, "up");
