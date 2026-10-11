import type { Status, StatusRule } from "@exadev/process-graph-domain";
import type { SyncFilter } from "@exadev/process-graph-source-contract";
import type { ComputedValue } from "trilean";
import type {
  FactsResult,
  SetArtefactResult,
  SetFactResult,
  SetResult,
  Written,
} from "./edit.ts";
import type {
  AncestorsResult,
  BlockedResult,
  ChildrenResult,
  CyclesResult,
  HandoffsResult,
  ImpactResult,
  PathResult,
  ReadyResult,
  WhyResult,
} from "./queries.ts";
import type { ElementSummary } from "./session.ts";
import {
  directionNames,
  type SyncInterruption,
  type SyncResult,
} from "./sync.ts";
import type { ValidateResult } from "./validate.ts";

/**
 * Text renderings of each command's result. Lists are one item per line with tab-separated fields, so they cut, sort and grep cleanly, and an empty list prints nothing. Every rendering ends with a line break when it is not empty.
 */
const lines = (rows: readonly string[]): string =>
  rows.length === 0 ? "" : `${rows.join("\n")}\n`;

const elementRows = (elements: readonly ElementSummary[]): readonly string[] =>
  elements.map((element) => `${element.id}\t${element.label}`);

/** `ready`: each ready element's identifier and label. */
export const renderReady = (result: ReadyResult): string =>
  lines(elementRows(result.elements));

/** `blocked`: each element at the end of the blocked-by chain. */
export const renderBlocked = (result: BlockedResult): string =>
  lines(elementRows(result.blockedBy));

/** `impact`: each element that depends on the one asked about. */
export const renderImpact = (result: ImpactResult): string =>
  lines(elementRows(result.impacted));

/** `children`: each direct sub-task's identifier and label. */
export const renderChildren = (result: ChildrenResult): string =>
  lines(elementRows(result.children));

/** `ancestors`: each element above the one asked about, nearest first, with its distance. */
export const renderAncestors = (result: AncestorsResult): string =>
  lines(
    result.ancestors.map(
      (link) => `${link.id}\t${link.label}\t${String(link.distance)}`,
    ),
  );

/** `path`: the critical path, one element per line in dependency order. */
export const renderPath = (result: PathResult): string =>
  lines(elementRows(result.path));

/** `cycles`: each illegal cycle as a closed path. */
export const renderCycles = (result: CyclesResult): string =>
  lines(result.cycles.map((cycle) => cycle.join(" -> ")));

/** `handoffs`: each hand-off's transition and the actors it passes between. */
export const renderHandoffs = (result: HandoffsResult): string =>
  lines(
    result.handoffs.map(
      (handoff) => `${handoff.transition}\t${handoff.from} -> ${handoff.to}`,
    ),
  );

/** The sentence that says why each rule gives its status. `needs-met` gives a decision or pseudo-state `done` rather than `ready`, and says so. */
const ruleSentences: Readonly<Record<StatusRule, string>> = {
  "overlay-done": "its run state is done",
  "overlay-unknown": "its run state is unknown",
  "unknown-need":
    "something it needs is unknown, or a condition on the way to it cannot be decided",
  "all-cut": "every transition into it is cut",
  "needs-met": "everything it needs is done",
  waiting: "it waits on work that is not done",
};

const ruleSentence = (rule: StatusRule, status: Status): string =>
  rule === "needs-met" && status === "done"
    ? "it is a decision or pseudo-state and everything it needs is done"
    : ruleSentences[rule];

/** `why`: the status and the rule behind it, then its needs, its artefacts and the blocked-by chain, each section only when it has something in it. */
export const renderWhy = (result: WhyResult): string => {
  const { element } = result;
  const needs = result.transitions.map((transition) => {
    const notes = [
      ...(transition.branch === "taken"
        ? []
        : [`condition ${transition.branch}`]),
      ...(transition.cut ? ["cut"] : []),
    ];

    return `  ${transition.source} (${transition.sourceStatus}) through ${transition.transition}${notes.length === 0 ? "" : `, ${notes.join(", ")}`}`;
  });
  const artefacts = result.artefacts.map((artefact) => {
    const producers =
      artefact.producers.length === 0
        ? "produced by nothing"
        : `produced by ${artefact.producers
            .map((producer) => `${producer.element} (${producer.status})`)
            .join(", ")}`;

    return `  ${artefact.artefact}: ${artefact.provided ? "provided" : "not provided"}, ${producers}`;
  });
  const chain =
    result.chain.length > 1 ||
    result.chain.some((link) => link.waitingOn.length > 0)
      ? result.chain.map(
          (link) =>
            `  ${link.id} (${link.status})${link.waitingOn.length === 0 ? "" : ` waits on ${link.waitingOn.join(", ")}`}`,
        )
      : [];

  return lines([
    `${element.id} is ${element.status}: ${ruleSentence(result.rule, element.status)}`,
    ...(needs.length === 0 ? [] : ["needs:", ...needs]),
    ...(artefacts.length === 0 ? [] : ["artefacts:", ...artefacts]),
    ...(chain.length === 0 ? [] : ["blocked-by chain:", ...chain]),
  ]);
};

/** `add`: what was added and the revision it took. */
export const renderAdded = (
  kind: string,
  id: string,
  written: Written,
): string =>
  lines([`added ${kind} ${id} at revision ${String(written.revision)}`]);

/** `set`: the element's new run state and the revision it took. */
export const renderSet = (result: SetResult): string =>
  lines([
    `set ${result.element} to ${result.state} at revision ${String(result.revision)}`,
  ]);

/** A fact's value as the command line reads it back: a boolean or number as written, text as it is, and the other kinds as their JSON. */
const valueText = (value: ComputedValue): string => {
  if (value.kind === "boolean" || value.kind === "number") {
    return value.kind === "number" && value.unit !== undefined
      ? JSON.stringify(value)
      : String(value.value);
  }

  return value.kind === "text" ? value.value : JSON.stringify(value);
};

/** `set artefact`: the artefact's new state and the revision it took. */
export const renderSetArtefact = (result: SetArtefactResult): string =>
  lines([
    `set artefact ${result.artefact} to ${result.state} at revision ${String(result.revision)}`,
  ]);

/** `set fact`: the fact's new value and the revision it took. */
export const renderSetFact = (result: SetFactResult): string =>
  lines([
    `set fact ${result.fact} to ${result.value === "unknown" ? "unknown" : valueText(result.value)} at revision ${String(result.revision)}`,
  ]);

/** `facts`: each recorded artefact as `artefact`, its id and `provided` or `absent`, then each named fact as `fact`, its name and its value, each sorted by id or name. */
export const renderFacts = (result: FactsResult): string =>
  lines([
    ...Object.entries(result.facts.artefacts)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([id, provided]) =>
          `artefact\t${id}\t${provided ? "provided" : "absent"}`,
      ),
    ...Object.entries(result.facts.values)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]) => `fact\t${name}\t${valueText(value)}`),
  ]);

/** `sync`: what was written, then each gap as its reason, target and message. */
export const renderSync = (result: SyncResult): string =>
  lines([
    `synced ${String(result.activities)} activities, ${String(result.transitions)} transitions, ${String(result.relations)} relations and ${String(result.participants)} participants into "${result.modelId}" at revision ${String(result.revision)}`,
    ...result.gaps.map(
      (gap) => `gap\t${gap.reason}\t${gap.target}\t${gap.message}`,
    ),
  ]);

/**
 * The `sync` options that give a filter, as they would be typed again to resume under it, since a cursor is valid only under the filter it was issued with.
 * @param filter - The filter, if any.
 * @returns The options, each with a leading space, or the empty string.
 */
const filterOptions = (filter: SyncFilter | undefined): string =>
  [
    ...(filter?.states ?? []).map((state) => ` --state ${state}`),
    ...(filter?.labels ?? []).map((label) => ` --label ${label}`),
    ...(filter?.order === undefined
      ? []
      : [
          ` --order ${filter.order.field} --direction ${filter.order.direction === directionNames.desc ? "desc" : "asc"}`,
        ]),
  ].join("");

/**
 * A sync a source interrupted: the source's failure, whether the pages read before it were saved, and the commands that carry on, `resume with: sync <scopes> --after <cursor>` for the failing source and `then: sync <scopes>` for the sources not reached.
 * @param message - The source's failure.
 * @param interruption - Where the sync carries on.
 * @returns The lines for standard error, without a final line break.
 */
export const renderSyncInterruption = (
  message: string,
  interruption: SyncInterruption,
): string => {
  const { resume, remaining, saved } = interruption;

  return [
    message,
    ...(saved ? ["the pages read before the failure are saved"] : []),
    `resume with: sync ${resume.scopes.join(" ")}${resume.after === undefined ? "" : ` --after ${resume.after}`}${filterOptions(resume.filter)}`,
    ...(remaining.length === 0
      ? []
      : [`then: sync ${remaining.join(" ")}${filterOptions(resume.filter)}`]),
  ].join("\n");
};

/** `validate`: `valid`, or each issue as its code, its JSON pointer when it has one, and its message. */
export const renderValidate = (result: ValidateResult): string =>
  result.valid
    ? lines(["valid"])
    : lines(
        result.issues.map((issue) =>
          issue.pointer === undefined
            ? `${issue.code}\t${issue.message}`
            : `${issue.code}\t${issue.pointer === "" ? "/" : issue.pointer}\t${issue.message}`,
        ),
      );
