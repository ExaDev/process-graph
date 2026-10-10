import { loopTransitions } from "@exadev/process-graph-domain";
import type { Model, OpenIds, Overlay } from "@exadev/process-graph-schema";
import type { Reach } from "./schema.ts";

/**
 * Whether an element is a pure control element: a `decision` or a pseudo-state. Control elements have no work of their own, so the structural queries pass through them and never report them.
 */
const isControl = (kind: Model<OpenIds>["elements"][number]["kind"]): boolean =>
  kind === "decision" || kind === "pseudo";

/**
 * Reads a key every caller knows is present: the structural view has an entry for every element of a valid model.
 * @throws Error when the key is absent, which only an invalid model can cause.
 */
const lookup = <V>(map: ReadonlyMap<string, V>, key: string): V => {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`No element "${key}" in the structural view`);
  }

  return value;
};

/** Which way a traversal follows transitions: towards what an element waits on, or towards what waits on it. */
type Direction = "upstream" | "downstream";

/**
 * The structural view of a stored model that the store's queries read: its elements in model order, its transitions without the loop edges `graph-domain` identifies, and its run state.
 */
export interface Structure {
  readonly order: ReadonlyMap<string, number>;
  readonly control: ReadonlySet<string>;
  readonly done: ReadonlySet<string>;
  readonly open: ReadonlySet<string>;
  readonly upstream: ReadonlyMap<string, readonly string[]>;
  readonly downstream: ReadonlyMap<string, readonly string[]>;
}

/**
 * Builds the structural view of a model and its overlay.
 * @param model - A valid model.
 * @param overlay - Its run state.
 * @returns The view the queries below read.
 */
export const structureOf = (
  model: Model<OpenIds>,
  overlay: Overlay<OpenIds>,
): Structure => {
  const loops = new Set(loopTransitions(model));
  const upstream = new Map<string, string[]>(
    model.elements.map(({ id }) => [id, []]),
  );
  const downstream = new Map<string, string[]>(
    model.elements.map(({ id }) => [id, []]),
  );
  for (const { id, source, target } of model.transitions) {
    if (!loops.has(id)) {
      lookup(upstream, target).push(source);
      lookup(downstream, source).push(target);
    }
  }

  return {
    order: new Map(model.elements.map(({ id }, index) => [id, index])),
    control: new Set(
      model.elements.flatMap(({ id, kind }) => (isControl(kind) ? [id] : [])),
    ),
    done: new Set(
      model.elements.flatMap(({ id }) => (overlay[id] === "done" ? [id] : [])),
    ),
    open: new Set(
      model.elements.flatMap(({ id }) =>
        overlay[id] === undefined || overlay[id] === "open" ? [id] : [],
      ),
    ),
    upstream,
    downstream,
  };
};

/**
 * Breadth-first traversal from `start` along non-loop transitions in one direction, expanding only elements that are not done. Returns every element reached that is neither done nor a control element, with the fewest transitions it takes to reach it, ordered by that distance and then by model order. `start` itself is not reported.
 */
const reach = (
  structure: Structure,
  start: string,
  direction: Direction,
): readonly Reach[] => {
  const next = structure[direction];
  const distance = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  for (let depth = 1; frontier.length > 0; depth += 1) {
    const reached = frontier
      .flatMap((element) => lookup(next, element))
      .filter((neighbour) => !distance.has(neighbour));
    for (const neighbour of reached) {
      distance.set(neighbour, depth);
    }
    frontier = [...new Set(reached)].filter(
      (neighbour) => !structure.done.has(neighbour),
    );
  }
  distance.delete(start);

  return [...distance]
    .filter(
      ([element]) =>
        !structure.done.has(element) && !structure.control.has(element),
    )
    .map(([element, steps]) => ({ element, distance: steps }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        lookup(structure.order, left.element) -
          lookup(structure.order, right.element),
    );
};

/**
 * What still stands before an element: the unfinished work upstream of it. An element that is done waits on nothing.
 * @param structure - The structural view.
 * @param element - An element of the model.
 * @returns The upstream elements that are not done and are not control elements, by distance and then model order.
 */
export const blockedChainOf = (
  structure: Structure,
  element: string,
): readonly Reach[] =>
  structure.done.has(element) ? [] : reach(structure, element, "upstream");

/**
 * What depends on an element: the unfinished work downstream of it, whatever the element's own state.
 * @param structure - The structural view.
 * @param element - An element of the model.
 * @returns The downstream elements that are not done and are not control elements, by distance and then model order.
 */
export const impactOf = (
  structure: Structure,
  element: string,
): readonly Reach[] => reach(structure, element, "downstream");

/**
 * The work that can start now: every open element (no run state, or `open`) that is not a control element and has nothing unfinished upstream.
 * @param structure - The structural view.
 * @returns The ready elements, in model order.
 */
export const readyOf = (structure: Structure): readonly string[] =>
  [...structure.order.keys()].filter(
    (element) =>
      structure.open.has(element) &&
      !structure.control.has(element) &&
      blockedChainOf(structure, element).length === 0,
  );
