import type { Status } from "@exadev/process-graph-domain";
import type { Element, IdSpace, Model } from "@exadev/process-graph-schema";
import { useCallback, useMemo, useState } from "react";

/**
 * Which elements to show. Each set constrains one property, and an empty set does not constrain it, so the empty filter shows everything. An element is shown when it passes every set that is not empty.
 */
export interface ElementFilter {
  /** Statuses to show. */
  readonly statuses: ReadonlySet<Status>;
  /** Actors to show the work of, by participant id. An element with no actor, such as a start or end, never matches a non-empty set. */
  readonly actors: ReadonlySet<string>;
  /** Sources to show the work of, by `sourceScope`. An element bound to no source never matches a non-empty set. */
  readonly sources: ReadonlySet<string>;
}

/** The filter that shows every element. */
export const emptyFilter: ElementFilter = {
  statuses: new Set(),
  actors: new Set(),
  sources: new Set(),
};

/** The separator between a source-qualified identifier's collection and its item, as in `github:org/repo#12`. */
const itemSeparator = "#";

/**
 * The collection a source-qualified identifier belongs to: the identifier up to its item separator, so `github:org/repo#12` is in `github:org/repo`. An identifier with no item separator is its own collection.
 * @param source - A source-qualified identifier.
 * @returns The identifier's collection.
 */
export const sourceScope = (source: string): string => {
  const at = source.lastIndexOf(itemSeparator);

  return at === -1 ? source : source.slice(0, at);
};

/**
 * The actors an element's work belongs to: the actor of an activity or decision, and both ends of a message.
 * @param element - The element.
 * @returns Its actors' participant ids.
 */
export const actorsOf = <I extends IdSpace>(
  element: Element<I["element"], I>,
): readonly I["actor"][] => {
  if (element.kind === "message") {
    return [element.from, element.to];
  }

  return (element.kind === "activity" || element.kind === "decision") &&
    element.actor !== undefined
    ? [element.actor]
    : [];
};

const passes = (
  allowed: ReadonlySet<string>,
  values: readonly string[],
): boolean => allowed.size === 0 || values.some((value) => allowed.has(value));

/**
 * Whether an element passes a filter.
 * @param element - The element.
 * @param status - The element's status in the run.
 * @param filter - The filter.
 * @returns True when the element is shown.
 */
export const matchesFilter = <I extends IdSpace>(
  element: Element<I["element"], I>,
  status: Status,
  filter: ElementFilter,
): boolean =>
  passes(filter.statuses, [status]) &&
  passes(filter.actors, actorsOf(element)) &&
  passes(
    filter.sources,
    element.kind === "activity" && element.source !== undefined
      ? [sourceScope(element.source)]
      : [],
  );

/**
 * The elements a filter shows.
 * @param model - The model.
 * @param statuses - Each element's status, from `useStatuses`.
 * @param filter - The filter.
 * @returns The shown elements' ids, in model order.
 */
export const filterElements = <I extends IdSpace>(
  model: Model<I>,
  statuses: ReadonlyMap<I["element"], Status>,
  filter: ElementFilter,
): readonly I["element"][] =>
  model.elements.flatMap((element) => {
    const status = statuses.get(element.id);

    return status !== undefined && matchesFilter(element, status, filter)
      ? [element.id]
      : [];
  });

/** A value a filter can select, and the text it is shown with. */
export interface FilterOption<V extends string = string> {
  readonly value: V;
  readonly label: string;
}

/** What a model's elements can be filtered by, beyond status. */
export interface FilterOptions {
  /** The roles and systems that are some element's actor, in declaration order. */
  readonly actors: readonly FilterOption[];
  /** The source collections of the model's bound activities, in order of first appearance. */
  readonly sources: readonly FilterOption[];
}

/**
 * The actors and sources a model's elements can be filtered by.
 * @param model - The model.
 * @returns The options, each labelled for display.
 */
export const filterOptions = <I extends IdSpace>(
  model: Model<I>,
): FilterOptions => {
  const acting = new Set<string>(model.elements.flatMap(actorsOf));
  const sources = new Set<string>(
    model.elements.flatMap((element) =>
      element.kind === "activity" && element.source !== undefined
        ? [sourceScope(element.source)]
        : [],
    ),
  );

  return {
    actors: model.participants
      .filter((participant) => acting.has(participant.id))
      .map((participant) => ({
        value: participant.id,
        label: participant.label,
      })),
    sources: [...sources].map((source) => ({ value: source, label: source })),
  };
};

/** A filter and the operations that change it. */
export interface ElementFilterState {
  readonly filter: ElementFilter;
  /** Adds the status to the filter, or removes it when it is there. */
  readonly toggleStatus: (status: Status) => void;
  /** Adds the actor to the filter, or removes it when it is there. */
  readonly toggleActor: (actor: string) => void;
  /** Adds the source collection to the filter, or removes it when it is there. */
  readonly toggleSource: (source: string) => void;
  /** Clears every constraint. */
  readonly clear: () => void;
}

const toggled = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
  const next = new Set(set);
  if (!next.delete(value)) {
    next.add(value);
  }

  return next;
};

/**
 * Filter state for a view: which statuses, actors and sources to show.
 * @param initial - The filter to start with. Defaults to `emptyFilter`.
 * @returns The filter and its operations, each stable between renders.
 */
export const useElementFilter = (
  initial: ElementFilter = emptyFilter,
): ElementFilterState => {
  const [filter, setFilter] = useState(initial);
  const toggleStatus = useCallback((status: Status) => {
    setFilter((current) => ({
      ...current,
      statuses: toggled(current.statuses, status),
    }));
  }, []);
  const toggleActor = useCallback((actor: string) => {
    setFilter((current) => ({
      ...current,
      actors: toggled(current.actors, actor),
    }));
  }, []);
  const toggleSource = useCallback((source: string) => {
    setFilter((current) => ({
      ...current,
      sources: toggled(current.sources, source),
    }));
  }, []);
  const clear = useCallback(() => {
    setFilter(emptyFilter);
  }, []);

  return useMemo(
    () => ({ filter, toggleStatus, toggleActor, toggleSource, clear }),
    [filter, toggleStatus, toggleActor, toggleSource, clear],
  );
};
