import type { ArtefactDef } from "./declarations.ts";
import type { IdSpace } from "./ids.ts";
import type { Model } from "./model.ts";

/**
 * The artefacts the process takes as given: those no activity produces, in declaration order.
 * @param model - The model to read.
 * @returns The declared artefacts that appear in no activity's `produces`.
 */
export const inputsOf = <I extends IdSpace>(
  model: Model<I>,
): readonly ArtefactDef<I["artefact"]>[] => {
  const produced = new Set<I["artefact"]>(
    model.elements.flatMap((element) =>
      element.kind === "activity" ? (element.produces ?? []) : [],
    ),
  );

  return model.artefacts.filter((artefact) => !produced.has(artefact.id));
};

/**
 * The artefacts the process exists to deliver: those flagged `deliverable`, in declaration order.
 * @param model - The model to read.
 * @returns The declared artefacts flagged `deliverable`.
 */
export const outputsOf = <I extends IdSpace>(
  model: Model<I>,
): readonly ArtefactDef<I["artefact"]>[] =>
  model.artefacts.filter((artefact) => artefact.deliverable === true);
