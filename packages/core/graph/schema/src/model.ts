import type {
  AnyParticipants,
  ActionDef,
  ArtefactDef,
  Element,
  EventDef,
  Fragment,
  IdsOfKind,
  Participant,
  Projection,
  Transition,
  Views,
} from "./declarations.ts";
import type { IdSpace } from "./ids.ts";

export interface ModelParts<
  D extends IdSpace,
  R extends IdSpace,
  Ps extends AnyParticipants = readonly Participant<D["participant"]>[],
> {
  readonly participants: Ps;
  readonly events: readonly EventDef<D["event"]>[];
  readonly actions: readonly ActionDef<D["action"]>[];
  readonly artefacts: readonly ArtefactDef<D["artefact"]>[];
  readonly elements: readonly Element<D["element"], R>[];
  readonly transitions: readonly Transition<D["transition"], R>[];
  readonly fragments: readonly Fragment<D["fragment"], R>[];
  readonly projections: readonly Projection<R>[];
  readonly views?: Views<R["element"]>;
}

export type Model<I extends IdSpace> = ModelParts<I, I>;

/**
 * Declare a model. Each identifier union is inferred from the declaring arrays only, so every reference elsewhere is checked against what was declared.
 *
 * The participants array is captured whole, with each kind kept as a literal. Actors and message ends are then checked against the role and system participants, and a state machine subject against the entity participants.
 */
export const defineModel = <
  const Ps extends AnyParticipants,
  const Ev extends string,
  const Ac extends string,
  const El extends string,
  const Tr extends string,
  const Fr extends string,
  const Ar extends string,
>(
  model: ModelParts<
    {
      readonly participant: Ps[number]["id"];
      readonly actor: IdsOfKind<Ps, "role" | "system">;
      readonly entity: IdsOfKind<Ps, "entity">;
      readonly event: Ev;
      readonly action: Ac;
      readonly element: El;
      readonly transition: Tr;
      readonly fragment: Fr;
      readonly artefact: Ar;
    },
    {
      readonly participant: NoInfer<Ps[number]["id"]>;
      readonly actor: NoInfer<IdsOfKind<Ps, "role" | "system">>;
      readonly entity: NoInfer<IdsOfKind<Ps, "entity">>;
      readonly event: NoInfer<Ev>;
      readonly action: NoInfer<Ac>;
      readonly element: NoInfer<El>;
      readonly transition: NoInfer<Tr>;
      readonly fragment: NoInfer<Fr>;
      readonly artefact: NoInfer<Ar>;
    },
    Ps
  >,
): Model<{
  readonly participant: Ps[number]["id"];
  readonly actor: IdsOfKind<Ps, "role" | "system">;
  readonly entity: IdsOfKind<Ps, "entity">;
  readonly event: Ev;
  readonly action: Ac;
  readonly element: El;
  readonly transition: Tr;
  readonly fragment: Fr;
  readonly artefact: Ar;
}> => model;
