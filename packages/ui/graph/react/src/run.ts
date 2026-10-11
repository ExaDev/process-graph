import type { Facts } from "@exadev/process-graph-domain";
import type { IdSpace, Model, Overlay } from "@exadev/process-graph-schema";

/**
 * Everything the reasoning hooks read: the model, its run overlay and the injected source of facts that conditions and provided artefacts are answered from. Keep the three stable between renders (from state, a store or `useMemo`), since the hooks recompute whenever one of them changes identity.
 */
export interface Run<I extends IdSpace> {
  readonly model: Model<I>;
  readonly overlay: Readonly<Overlay<I>>;
  readonly facts: Facts;
}

/**
 * The facts port of a run that has no facts source: every key is not found, so a condition that reads one is indeterminate and no input artefact counts as provided.
 * @returns `{ found: false }` for every key.
 */
export const noFacts: Facts = () => ({ found: false });
