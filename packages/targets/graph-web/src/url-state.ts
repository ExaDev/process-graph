import { statuses, type Status } from "@exadev/process-graph-domain";
import { emptyFilter, type ElementFilter } from "@exadev/process-graph-react";

/** The views the app draws, named as the command line's `show --view` names them. */
export const viewKinds = [
  "flowchart",
  "swimlane",
  "state",
  "sequence",
] as const;
export type ViewKind = (typeof viewKinds)[number];

/** The lists beside the view, one per question the command line answers about the whole model. */
export const listTabs = [
  "ready",
  "blocked",
  "path",
  "handoffs",
  "cycles",
  "issues",
] as const;
export type ListTab = (typeof listTabs)[number];

/**
 * Everything a link to the app carries: what to read, how to show it and what is picked out. Two people opening the same link see the same view of the same scopes, each from their own store.
 */
export interface ViewState {
  /** Source-qualified scopes, such as `github:owner` or `github:owner/repo`, in the order given, each once. */
  readonly scopes: readonly string[];
  readonly view: ViewKind;
  /** The selected element's identifier. */
  readonly selected: string | undefined;
  readonly filter: ElementFilter;
  readonly tab: ListTab;
  /** The entity a state machine follows; absent to use the model's own state machine projection. */
  readonly subject: string | undefined;
  /** The transitions a sequence diagram follows, in order; empty to use the model's own sequence projection, or the critical path. */
  readonly scenario: readonly string[];
}

/** The view a link with no parameters opens. */
export const defaultViewState: ViewState = {
  scopes: [],
  view: "swimlane",
  selected: undefined,
  filter: emptyFilter,
  tab: "ready",
  subject: undefined,
  scenario: [],
};

/**
 * The query parameters, one name per part of the state. A repeatable part repeats its parameter, in order: `?scope=github:a&scope=github:b/c`.
 */
export const parameters = {
  scope: "scope",
  view: "view",
  selected: "select",
  status: "status",
  actor: "actor",
  source: "source",
  tab: "list",
  subject: "subject",
  scenario: "step",
} as const;

/** What reading a link found, and anything in it that could not be used. */
export interface ParsedViewState {
  readonly state: ViewState;
  /** One sentence per parameter value that was not understood and so was left out. */
  readonly problems: readonly string[];
}

/** The separator between a scope's source and the rest, as in `github:owner/repo`. */
const sourceSeparator = ":";

/**
 * Whether a string is source-qualified: a source name, a colon, and something after it.
 * @param scope - The candidate scope.
 */
export const isQualifiedScope = (scope: string): boolean => {
  const at = scope.indexOf(sourceSeparator);

  return at > 0 && at < scope.length - 1;
};

const unique = (values: readonly string[]): readonly string[] => [
  ...new Set(values),
];

const isMember = <T extends string>(
  values: readonly T[],
  value: string,
): value is T => values.some((candidate) => candidate === value);

/**
 * Reads the state from a URL's query string. A value that cannot be used (an unknown view, a status that does not exist, a scope that is not source-qualified) is left out and named in `problems`, so a mistyped link shows what it ignored rather than failing to open.
 * @param search - The query string, with or without its leading `?`.
 * @returns The state, with the defaults for whatever the query does not set, and the problems.
 */
export const parseViewState = (search: string): ParsedViewState => {
  const query = new URLSearchParams(search);
  const problems: string[] = [];
  const all = (name: string): readonly string[] =>
    query.getAll(name).filter((value) => value !== "");
  const one = (name: string): string | undefined => all(name).at(-1);

  const scopes = all(parameters.scope).filter((scope) => {
    const qualified = isQualifiedScope(scope);
    if (!qualified) {
      problems.push(
        `The scope "${scope}" names no source; write it as source:scope, such as github:owner/repo.`,
      );
    }

    return qualified;
  });

  const viewValue = one(parameters.view);
  let view = defaultViewState.view;
  if (viewValue !== undefined) {
    if (isMember(viewKinds, viewValue)) {
      view = viewValue;
    } else {
      problems.push(
        `The view "${viewValue}" is not one of ${viewKinds.join(", ")}.`,
      );
    }
  }

  const tabValue = one(parameters.tab);
  let tab = defaultViewState.tab;
  if (tabValue !== undefined) {
    if (isMember(listTabs, tabValue)) {
      tab = tabValue;
    } else {
      problems.push(
        `The list "${tabValue}" is not one of ${listTabs.join(", ")}.`,
      );
    }
  }

  const filterStatuses = all(parameters.status).filter(
    (value): value is Status => {
      const known = isMember(statuses, value);
      if (!known) {
        problems.push(
          `The status "${value}" is not one of ${statuses.join(", ")}.`,
        );
      }

      return known;
    },
  );

  return {
    state: {
      scopes: unique(scopes),
      view,
      selected: one(parameters.selected),
      filter: {
        statuses: new Set(filterStatuses),
        actors: new Set(all(parameters.actor)),
        sources: new Set(all(parameters.source)),
      },
      tab,
      subject: one(parameters.subject),
      scenario: all(parameters.scenario),
    },
    problems,
  };
};

/**
 * Writes the state as a query string, leaving out every part that has its default, so the link to the default view is empty. Repeated parameters keep their order, and set members are written sorted, so the same state always gives the same link.
 * @param state - The state.
 * @returns The query string with its leading `?`, or the empty string.
 */
export const serialiseViewState = (state: ViewState): string => {
  const query = new URLSearchParams();
  for (const scope of state.scopes) {
    query.append(parameters.scope, scope);
  }
  if (state.view !== defaultViewState.view) {
    query.set(parameters.view, state.view);
  }
  if (state.tab !== defaultViewState.tab) {
    query.set(parameters.tab, state.tab);
  }
  if (state.selected !== undefined) {
    query.set(parameters.selected, state.selected);
  }
  const sets = [
    [parameters.status, state.filter.statuses],
    [parameters.actor, state.filter.actors],
    [parameters.source, state.filter.sources],
  ] as const;
  for (const [name, values] of sets) {
    for (const value of [...values].sort()) {
      query.append(name, value);
    }
  }
  if (state.subject !== undefined) {
    query.set(parameters.subject, state.subject);
  }
  for (const step of state.scenario) {
    query.append(parameters.scenario, step);
  }
  const text = query.toString();

  return text === "" ? "" : `?${text}`;
};

/**
 * The store's name for the model a set of scopes is synced into: the scopes sorted and joined by spaces, so the same scopes in any order are the same model, and different scopes never share one.
 * @param scopes - The scopes.
 * @returns The model identifier.
 */
export const modelIdOf = (scopes: readonly string[]): string =>
  unique(scopes).toSorted().join(" ");
