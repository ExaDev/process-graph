import type { Status, StatusRule } from "@exadev/process-graph-domain";
import type { Written, SetResult } from "./edit.ts";
import type {
  BlockedResult,
  CyclesResult,
  HandoffsResult,
  ImpactResult,
  PathResult,
  ReadyResult,
  WhyResult,
} from "./queries.ts";
import type { ElementSummary } from "./session.ts";
import type { SyncResult } from "./sync.ts";
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

/** `sync`: what was written, then each gap as its reason, target and message. */
export const renderSync = (result: SyncResult): string =>
  lines([
    `synced ${String(result.activities)} activities, ${String(result.transitions)} transitions and ${String(result.participants)} participants into "${result.modelId}" at revision ${String(result.revision)}`,
    ...result.gaps.map(
      (gap) => `gap\t${gap.reason}\t${gap.target}\t${gap.message}`,
    ),
  ]);

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
