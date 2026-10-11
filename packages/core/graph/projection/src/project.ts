import type { IdSpace, Model, Projection } from "@exadev/process-graph-schema";
import { toFlowchart, type Flowchart } from "./flowchart.ts";
import { toSequence, type SequenceDiagram } from "./sequence.ts";
import { toStateMachine, type StateMachine } from "./state-machine.ts";
import { toSwimlane, type Swimlane } from "./swimlane.ts";

/** The view each projection notation produces. */
export interface ViewsByNotation<I extends IdSpace> {
  readonly flowchart: Flowchart<I>;
  readonly swimlane: Swimlane<I>;
  readonly stateMachine: StateMachine<I>;
  readonly sequence: SequenceDiagram<I>;
}

/** A projection request together with the view it produced, discriminated by notation. */
export type ProjectedView<I extends IdSpace> = {
  readonly [N in keyof ViewsByNotation<I>]: {
    readonly notation: N;
    readonly view: ViewsByNotation<I>[N];
  };
}[keyof ViewsByNotation<I>];

/**
 * Projects a model into the notation a projection names, with the input it records (a subject, a scenario).
 * @param model - The model to project.
 * @param projection - One of the model's declared projections, or one built the same way.
 * @returns The notation and its view.
 */
export const project = <I extends IdSpace>(
  model: Model<I>,
  projection: Projection<I>,
): ProjectedView<I> => {
  if (projection.notation === "stateMachine") {
    return {
      notation: "stateMachine",
      view: toStateMachine(model, projection.subject),
    };
  }
  if (projection.notation === "sequence") {
    return {
      notation: "sequence",
      view: toSequence(model, projection.scenario),
    };
  }

  // A flowchart and a swimlane share one variant, which records nothing beyond its notation.
  return projection.notation === "swimlane"
    ? { notation: "swimlane", view: toSwimlane(model) }
    : { notation: "flowchart", view: toFlowchart(model) };
};
