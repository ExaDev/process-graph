import type { ProjectedView } from "@exadev/process-graph-projection";
import type { Model, OpenIds } from "@exadev/process-graph-schema";
import {
  flowchartToDot,
  sequenceToDot,
  stateMachineToDot,
  swimlaneToDot,
} from "./dot.ts";
import {
  flowchartToMermaid,
  sequenceToMermaid,
  stateMachineToMermaid,
  swimlaneToMermaid,
} from "./mermaid.ts";

/** The text formats a view is written in: Mermaid, Graphviz DOT, and the projection itself as JSON. */
export const exportFormats = ["mermaid", "dot", "json"] as const;

/** One of the text formats a view is written in. */
export type ExportFormat = (typeof exportFormats)[number];

/**
 * A projected view as text: Mermaid or Graphviz DOT source, or the projection as JSON indented by two spaces and ending in a line break. This is the one writer of a view's text, so the command line's `show` and a download from the web app give the same text for the same view.
 * @param model - The model the view was projected from, for the labels of a sequence diagram's participants.
 * @param projected - The view, as graph-projection's `project` gives it.
 * @param format - The format to write.
 * @returns The text.
 */
export const viewText = (
  model: Model<OpenIds>,
  projected: ProjectedView<OpenIds>,
  format: ExportFormat,
): string => {
  if (format === "json") {
    return `${JSON.stringify(projected.view, null, 2)}\n`;
  }
  const mermaid = format === "mermaid";
  if (projected.notation === "flowchart") {
    return mermaid
      ? flowchartToMermaid(projected.view)
      : flowchartToDot(projected.view);
  }
  if (projected.notation === "swimlane") {
    return mermaid
      ? swimlaneToMermaid(projected.view)
      : swimlaneToDot(projected.view);
  }
  if (projected.notation === "stateMachine") {
    return mermaid
      ? stateMachineToMermaid(projected.view)
      : stateMachineToDot(projected.view);
  }
  const labels = new Map(
    model.participants.map((participant) => [
      participant.id,
      participant.label,
    ]),
  );
  // An actor a loaded model names without declaring has no label of its own, so it is shown by its identifier, as the swimlane projection labels its lane.
  const participantLabel = (id: string): string => labels.get(id) ?? id;

  return mermaid
    ? sequenceToMermaid(projected.view, participantLabel)
    : sequenceToDot(projected.view, participantLabel);
};
