import type {
  ArtefactDef,
  Element,
  EventDef,
  Model,
  OpenIds,
  Participant,
  ParticipantKind,
  Transition,
} from "@exadev/process-graph-schema";

/** A record to add to the model, by the part of the model it belongs to, as the command line's `add` takes them. */
export type Addition =
  | { readonly kind: "participant"; readonly record: Participant<string> }
  | { readonly kind: "element"; readonly record: Element<string, OpenIds> }
  | { readonly kind: "event"; readonly record: EventDef<string> }
  | { readonly kind: "artefact"; readonly record: ArtefactDef<string> }
  | {
      readonly kind: "transition";
      readonly record: Transition<string, OpenIds>;
    };

/** What can be added, as the command line names it after `add`. */
export const additionKinds = [
  "participant",
  "activity",
  "decision",
  "state",
  "event",
  "artefact",
  "transition",
] as const;
export type AdditionKind = (typeof additionKinds)[number];

/** The participant kinds, as the command line's `--kind` takes them. */
export const participantKinds: readonly ParticipantKind[] = [
  "role",
  "system",
  "entity",
];

/** The fields of the add form, each trimmed; an empty optional field is left out of the record. */
export interface AdditionFields {
  readonly id: string;
  /** A label, or for an event or artefact its name. */
  readonly label: string;
  readonly participantKind: ParticipantKind;
  /** The actor of an activity or decision. */
  readonly actor: string;
  /** The parent of a state. */
  readonly parent: string;
  readonly deliverable: boolean;
  readonly source: string;
  readonly target: string;
  readonly guard: string;
  readonly trigger: string;
}

/**
 * Builds the record a form describes, as the command line's `add` does: a transition's identifier defaults to `<source>-><target>`, the form sources use.
 * @param kind - What to add.
 * @param fields - The form's fields.
 * @returns The addition.
 */
export const additionOf = (
  kind: AdditionKind,
  fields: AdditionFields,
): Addition => {
  const id = fields.id.trim();
  const label = fields.label.trim();
  const actor = fields.actor.trim();
  const parent = fields.parent.trim();
  const guard = fields.guard.trim();
  const trigger = fields.trigger.trim();
  if (kind === "participant") {
    return {
      kind: "participant",
      record: { id, label, kind: fields.participantKind },
    };
  }
  if (kind === "activity" || kind === "decision") {
    return {
      kind: "element",
      record: { kind, id, label, ...(actor === "" ? {} : { actor }) },
    };
  }
  if (kind === "state") {
    return {
      kind: "element",
      record: { kind, id, label, ...(parent === "" ? {} : { parent }) },
    };
  }
  if (kind === "event") {
    return { kind: "event", record: { id, name: label } };
  }
  if (kind === "artefact") {
    return {
      kind: "artefact",
      record: fields.deliverable
        ? { id, name: label, deliverable: true }
        : { id, name: label },
    };
  }
  const source = fields.source.trim();
  const target = fields.target.trim();

  return {
    kind: "transition",
    record: {
      id: id === "" ? `${source}->${target}` : id,
      source,
      target,
      ...(guard === "" ? {} : { guard }),
      ...(trigger === "" ? {} : { trigger }),
    },
  };
};

/**
 * The model with one record appended to the part it belongs to.
 * @param model - The model.
 * @param addition - The record.
 * @returns The new model; the store checks it when it is saved.
 */
export const withAddition = (
  model: Model<OpenIds>,
  addition: Addition,
): Model<OpenIds> => {
  if (addition.kind === "participant") {
    return { ...model, participants: [...model.participants, addition.record] };
  }
  if (addition.kind === "element") {
    return { ...model, elements: [...model.elements, addition.record] };
  }
  if (addition.kind === "event") {
    return { ...model, events: [...model.events, addition.record] };
  }
  if (addition.kind === "artefact") {
    return { ...model, artefacts: [...model.artefacts, addition.record] };
  }

  return { ...model, transitions: [...model.transitions, addition.record] };
};
