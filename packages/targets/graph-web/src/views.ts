import type { Model, OpenIds, Projection } from "@exadev/process-graph-schema";
import type { ViewKind } from "./url-state.ts";

/** The projection a view draws, or why the model cannot be drawn that way. */
export type ResolvedView =
  | { readonly projection: Projection<OpenIds>; readonly unavailable?: never }
  | { readonly unavailable: string; readonly projection?: never };

/** What a view needs besides the model: the choices a link may carry and the critical path to fall back on. */
export interface ViewInputs {
  readonly view: ViewKind;
  /** The entity a state machine follows, from the link. */
  readonly subject: string | undefined;
  /** The transitions a sequence diagram follows, from the link. */
  readonly scenario: readonly string[];
  /** The critical path's elements, in dependency order. */
  readonly criticalPath: readonly string[];
}

/** The transitions that join consecutive elements of a path, in path order: the path as a scenario. */
export const transitionsAlong = (
  model: Model<OpenIds>,
  path: readonly string[],
): readonly string[] =>
  path.slice(1).flatMap((target, index) => {
    const source = path[index];
    const step = model.transitions.find(
      (transition) =>
        transition.source === source && transition.target === target,
    );

    return step === undefined ? [] : [step.id];
  });

/**
 * The projection to draw a view with. A flowchart and a swimlane need nothing more. A state machine follows the entity the link names, else the model's own state machine projection, else its first entity. A sequence diagram follows the transitions the link names, else the model's own sequence projection, else the critical path read as a scenario.
 * @param model - The model.
 * @param inputs - The view and what it may follow.
 * @returns The projection, or a sentence saying why there is none.
 */
export const resolveView = (
  model: Model<OpenIds>,
  inputs: ViewInputs,
): ResolvedView => {
  const { view, subject, scenario, criticalPath } = inputs;
  if (view === "flowchart" || view === "swimlane") {
    return { projection: { id: view, notation: view } };
  }
  if (view === "state") {
    const entities = model.participants.filter(
      (participant) => participant.kind === "entity",
    );
    const declared = model.projections.find(
      (projection) => projection.notation === "stateMachine",
    );
    const chosen =
      subject ??
      (declared?.notation === "stateMachine" ? declared.subject : undefined) ??
      entities[0]?.id;
    if (chosen === undefined) {
      return {
        unavailable:
          "A state machine follows one entity through its states, and this model declares no entity. Issues from a source are work, not entities; add an entity to follow one.",
      };
    }
    if (!entities.some((entity) => entity.id === chosen)) {
      return {
        unavailable: `"${chosen}" is not an entity of this model, so it has no states to follow.`,
      };
    }

    return {
      projection: { id: "state", notation: "stateMachine", subject: chosen },
    };
  }

  const declared = model.projections.find(
    (projection) => projection.notation === "sequence",
  );
  const steps =
    scenario.length > 0
      ? scenario
      : declared?.notation === "sequence"
        ? declared.scenario
        : transitionsAlong(model, criticalPath);
  if (steps.length === 0) {
    return {
      unavailable:
        "A sequence diagram follows one path of transitions, and there is none to follow: no work is waiting on other work.",
    };
  }
  const known = new Set(model.transitions.map((transition) => transition.id));
  const unknown = steps.find((step) => !known.has(step));
  if (unknown !== undefined) {
    return {
      unavailable: `"${unknown}" is not a transition of this model, so the sequence cannot follow it.`,
    };
  }

  return {
    projection: { id: "sequence", notation: "sequence", scenario: steps },
  };
};
