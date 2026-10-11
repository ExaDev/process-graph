import {
  toFlowchart,
  toSequence,
  toStateMachine,
  toSwimlane,
  type Flowchart,
  type SequenceDiagram,
  type StateMachine,
  type Swimlane,
} from "@exadev/process-graph-projection";
import type { Model, OpenIds } from "@exadev/process-graph-schema";
import type { ProjectedView as NotationView } from "@exadev/process-graph-projection";
import { viewText, type ExportFormat } from "@exadev/process-graph-export";
import { CliError } from "./errors.ts";
import { exitCodes } from "./exit-codes.ts";
import { loadRun, type GraphSession } from "./session.ts";

/** The views `show` draws, as named on the command line. */
export const viewNames = [
  "flowchart",
  "swimlane",
  "state",
  "sequence",
] as const;

/** One of the views `show` draws. */
export type ViewName = (typeof viewNames)[number];

/** The formats `show` writes, graph-export's, with JSON named first. */
export const formatNames = [
  "json",
  "mermaid",
  "dot",
] as const satisfies readonly ExportFormat[];

/** One of the formats `show` writes. */
export type FormatName = (typeof formatNames)[number];

/** What to draw. */
export interface ShowRequest {
  readonly view: ViewName;
  readonly format: FormatName;
  /** The entity a state machine follows; the model's declared state machine projection when absent. */
  readonly subject?: string;
  /** The transitions a sequence diagram follows, in order; the model's declared sequence projection when absent. */
  readonly scenario?: readonly string[];
}

/** A projected view, tagged by which it is. */
export type ProjectedView =
  | { readonly view: "flowchart"; readonly projection: Flowchart<OpenIds> }
  | { readonly view: "swimlane"; readonly projection: Swimlane<OpenIds> }
  | { readonly view: "state"; readonly projection: StateMachine<OpenIds> }
  | {
      readonly view: "sequence";
      readonly projection: SequenceDiagram<OpenIds>;
    };

/** A drawn view: the projection, and its text in the requested format (the projection as JSON for `json`). */
export type ShowResult = ProjectedView & {
  readonly format: FormatName;
  readonly text: string;
};

const subjectOf = (
  model: Model<OpenIds>,
  given: string | undefined,
): string => {
  const subject =
    given ??
    model.projections.find(
      (projection) => projection.notation === "stateMachine",
    )?.subject;
  if (subject === undefined) {
    throw new CliError(
      exitCodes.usage,
      "the state view needs --subject <entity>: the model declares no state machine projection",
    );
  }
  const participant = model.participants.find(
    (candidate) => candidate.id === subject,
  );
  if (participant === undefined) {
    throw new CliError(
      exitCodes.notFound,
      `no participant "${subject}" in the model`,
    );
  }
  if (participant.kind !== "entity") {
    throw new CliError(
      exitCodes.usage,
      `"${subject}" is a ${participant.kind}; a state machine follows an entity`,
    );
  }

  return subject;
};

const scenarioOf = (
  model: Model<OpenIds>,
  given: readonly string[] | undefined,
): readonly string[] => {
  const scenario =
    given ??
    model.projections.find((projection) => projection.notation === "sequence")
      ?.scenario;
  if (scenario === undefined) {
    throw new CliError(
      exitCodes.usage,
      "the sequence view needs --scenario <transition...>: the model declares no sequence projection",
    );
  }
  const declared = new Set(
    model.transitions.map((transition) => transition.id),
  );
  const unknown = scenario.filter((id) => !declared.has(id));
  if (unknown.length > 0) {
    throw new CliError(
      exitCodes.notFound,
      `no transition ${unknown.map((id) => `"${id}"`).join(", ")} in the model`,
    );
  }

  return scenario;
};

/**
 * Projects a model into a view.
 * @param model - The model.
 * @param request - The view, and the subject or scenario it needs.
 * @returns The projection, tagged by view.
 * @throws CliError with `usage` when a state machine or sequence diagram has nothing to follow, or the subject is not an entity, and with `notFound` when the subject or a scenario transition does not exist.
 */
export const project = (
  model: Model<OpenIds>,
  request: Pick<ShowRequest, "view" | "subject" | "scenario">,
): ProjectedView => {
  if (request.view === "flowchart") {
    return { view: "flowchart", projection: toFlowchart(model) };
  }
  if (request.view === "swimlane") {
    return { view: "swimlane", projection: toSwimlane(model) };
  }
  if (request.view === "state") {
    return {
      view: "state",
      projection: toStateMachine(model, subjectOf(model, request.subject)),
    };
  }

  return {
    view: "sequence",
    projection: toSequence(model, scenarioOf(model, request.scenario)),
  };
};

/** A view as `show` names it, as the projection layer names its notation. */
const notationViewOf = (projected: ProjectedView): NotationView<OpenIds> => {
  if (projected.view === "flowchart") {
    return { notation: "flowchart", view: projected.projection };
  }
  if (projected.view === "swimlane") {
    return { notation: "swimlane", view: projected.projection };
  }
  if (projected.view === "state") {
    return { notation: "stateMachine", view: projected.projection };
  }

  return { notation: "sequence", view: projected.projection };
};

/**
 * Writes a projected view as Mermaid or DOT source, or as JSON, through graph-export's `viewText`, the writer the web app's downloads use too.
 * @param model - The model, for participant labels.
 * @param projected - The view.
 * @param format - `mermaid`, `dot` or `json`.
 * @returns The text.
 */
export const emit = (
  model: Model<OpenIds>,
  projected: ProjectedView,
  format: FormatName,
): string => viewText(model, notationViewOf(projected), format);

/**
 * Draws the session's model as a view in a format.
 * @param session - The store and model.
 * @param request - The view, format, and the subject or scenario the view needs.
 */
export const show = async (
  session: GraphSession,
  request: ShowRequest,
): Promise<ShowResult> => {
  const { model } = await loadRun(session);
  const projected = project(model, request);
  const text = emit(model, projected, request.format);

  return { ...projected, format: request.format, text };
};
