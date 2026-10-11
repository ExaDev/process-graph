import { project, type ProjectedView } from "@exadev/process-graph-projection";
import type { IdSpace, Model, Projection } from "@exadev/process-graph-schema";
import { useMemo } from "react";

/**
 * A model's view in one notation, projected again only when the model or the projection changes.
 * @param model - The model to project.
 * @param projection - The projection to draw. Keep it stable between renders, for instance one of `model.projections`.
 * @returns The notation and its view.
 * @throws Error when a state machine's subject is not a declared entity.
 */
export const useProjection = <I extends IdSpace>(
  model: Model<I>,
  projection: Projection<I>,
): ProjectedView<I> =>
  useMemo(() => project(model, projection), [model, projection]);
