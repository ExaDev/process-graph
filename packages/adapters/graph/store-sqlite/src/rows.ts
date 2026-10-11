import {
  modelSchema,
  overlaySchema,
  type ElementKind,
  type Model,
  type OpenIds,
  type Overlay,
} from "@exadev/process-graph-schema";
import type { FactRecord } from "@exadev/process-graph-domain";
import { factRecordSchema } from "@exadev/process-graph-store-contract";
import type {
  actions,
  artefactFacts,
  artefacts,
  elements,
  events,
  fragments,
  models,
  namedFacts,
  overlay,
  participants,
  projections,
  transitions,
} from "./tables.ts";

/**
 * The mapping layer between the model and its rows. Writing flattens each record into its table's columns, with an absent optional field stored as null. Reading puts back only the fields that are not null and then parses the result with graph-schema's `modelSchema`, so what leaves the store is checked to be a model and storage layout never reaches the contract.
 */

/** Every row of one model, table by table, in the model's declared order. */
export interface ModelRows {
  readonly model: typeof models.$inferSelect;
  readonly participants: readonly (typeof participants.$inferSelect)[];
  readonly events: readonly (typeof events.$inferSelect)[];
  readonly actions: readonly (typeof actions.$inferSelect)[];
  readonly artefacts: readonly (typeof artefacts.$inferSelect)[];
  readonly elements: readonly (typeof elements.$inferSelect)[];
  readonly transitions: readonly (typeof transitions.$inferSelect)[];
  readonly fragments: readonly (typeof fragments.$inferSelect)[];
  readonly projections: readonly (typeof projections.$inferSelect)[];
}

/** The rows to insert for one model, table by table. */
export interface ModelInserts {
  readonly model: typeof models.$inferInsert;
  readonly participants: readonly (typeof participants.$inferInsert)[];
  readonly events: readonly (typeof events.$inferInsert)[];
  readonly actions: readonly (typeof actions.$inferInsert)[];
  readonly artefacts: readonly (typeof artefacts.$inferInsert)[];
  readonly elements: readonly (typeof elements.$inferInsert)[];
  readonly transitions: readonly (typeof transitions.$inferInsert)[];
  readonly fragments: readonly (typeof fragments.$inferInsert)[];
  readonly projections: readonly (typeof projections.$inferInsert)[];
}

/** A field that is present only when its column holds a value. Its type is loose on purpose: `fromRows` hands everything to `modelSchema`, which is the check. */
const present = <V>(
  key: string,
  value: V | null,
): Readonly<Record<string, V>> =>
  value === null ? {} : Object.fromEntries([[key, value]]);

/**
 * Flattens a model into rows.
 * @param modelId - The model's id in the store.
 * @param model - A valid model.
 * @param revision - The revision this write takes.
 * @param loops - The ids of the transitions graph-domain counts as loop edges.
 * @returns The rows to insert.
 */
export const toRows = (
  modelId: string,
  model: Model<OpenIds>,
  revision: number,
  loops: ReadonlySet<string>,
): ModelInserts => ({
  model: { id: modelId, revision, views: model.views ?? null },
  participants: model.participants.map(({ id, label, kind }, position) => ({
    modelId,
    id,
    position,
    label,
    kind,
  })),
  events: model.events.map(({ id, name, payload }, position) => ({
    modelId,
    id,
    position,
    name,
    payload: payload ?? null,
  })),
  actions: model.actions.map(({ id, name }, position) => ({
    modelId,
    id,
    position,
    name,
  })),
  artefacts: model.artefacts.map(({ id, name, deliverable }, position) => ({
    modelId,
    id,
    position,
    name,
    deliverable: deliverable ?? null,
  })),
  elements: model.elements.map((element, position) => {
    const common = {
      modelId,
      id: element.id,
      position,
      kind: element.kind,
      extensions: element.extensions ?? null,
    };
    if (element.kind === "activity") {
      return {
        ...common,
        label: element.label,
        actor: element.actor ?? null,
        action: element.action ?? null,
        source: element.source ?? null,
        affects: element.affects ?? null,
        consumes: element.consumes ?? null,
        produces: element.produces ?? null,
      };
    }
    if (element.kind === "decision") {
      return { ...common, label: element.label, actor: element.actor ?? null };
    }
    if (element.kind === "state") {
      return {
        ...common,
        label: element.label,
        parent: element.parent ?? null,
        entry: element.entry ?? null,
        exit: element.exit ?? null,
      };
    }
    if (element.kind === "pseudo") {
      return { ...common, role: element.role, parent: element.parent ?? null };
    }

    return {
      ...common,
      label: element.label,
      from: element.from,
      to: element.to,
      mode: element.mode,
      event: element.event ?? null,
    };
  }),
  transitions: model.transitions.map((transition, position) => ({
    modelId,
    id: transition.id,
    position,
    source: transition.source,
    target: transition.target,
    trigger: transition.trigger ?? null,
    guard: transition.guard ?? null,
    condition: transition.condition ?? null,
    effect: transition.effect ?? null,
    loop: loops.has(transition.id),
  })),
  fragments: model.fragments.map(({ id, operator, operands }, position) => ({
    modelId,
    id,
    position,
    operator,
    operands,
  })),
  projections: model.projections.map((projection, position) => ({
    modelId,
    position,
    id: projection.id,
    notation: projection.notation,
    subject: "subject" in projection ? projection.subject : null,
    scenario: "scenario" in projection ? projection.scenario : null,
  })),
});

type ElementRow = typeof elements.$inferSelect;

/** The fields each element kind takes from its row, beyond the kind, id and extensions every element has. Keyed by every kind, so a new kind is a compile error here until it is mapped. */
const kindFields: Readonly<
  Record<ElementKind, (row: ElementRow) => Readonly<Record<string, unknown>>>
> = {
  activity: (row) => ({
    label: row.label,
    ...present("actor", row.actor),
    ...present("action", row.action),
    ...present("source", row.source),
    ...present("affects", row.affects),
    ...present("consumes", row.consumes),
    ...present("produces", row.produces),
  }),
  decision: (row) => ({ label: row.label, ...present("actor", row.actor) }),
  state: (row) => ({
    label: row.label,
    ...present("parent", row.parent),
    ...present("entry", row.entry),
    ...present("exit", row.exit),
  }),
  pseudo: (row) => ({ role: row.role, ...present("parent", row.parent) }),
  message: (row) => ({
    label: row.label,
    from: row.from,
    to: row.to,
    mode: row.mode,
    ...present("event", row.event),
  }),
};

/** Puts back the fields of one element row that belong to its kind. */
const elementOf = (row: ElementRow): unknown => ({
  kind: row.kind,
  id: row.id,
  ...present("extensions", row.extensions),
  ...kindFields[row.kind](row),
});

/**
 * Reassembles a model from its rows.
 * @param rows - Every row of the model, each table in position order.
 * @returns The model.
 * @throws ZodError when the rows do not make a model, which only a database changed outside the store can cause.
 */
export const fromRows = (rows: ModelRows): Model<OpenIds> =>
  modelSchema.parse({
    participants: rows.participants.map(({ id, label, kind }) => ({
      id,
      label,
      kind,
    })),
    events: rows.events.map(({ id, name, payload }) => ({
      id,
      name,
      ...present("payload", payload),
    })),
    actions: rows.actions.map(({ id, name }) => ({ id, name })),
    artefacts: rows.artefacts.map(({ id, name, deliverable }) => ({
      id,
      name,
      ...present("deliverable", deliverable),
    })),
    elements: rows.elements.map(elementOf),
    transitions: rows.transitions.map((row) => ({
      id: row.id,
      source: row.source,
      target: row.target,
      ...present("trigger", row.trigger),
      ...present("guard", row.guard),
      ...present("condition", row.condition),
      ...present("effect", row.effect),
    })),
    fragments: rows.fragments.map(({ id, operator, operands }) => ({
      id,
      operator,
      operands,
    })),
    projections: rows.projections.map((row) => ({
      id: row.id,
      notation: row.notation,
      ...present("subject", row.subject),
      ...present("scenario", row.scenario),
    })),
    ...present("views", rows.model.views),
  });

/**
 * Reassembles an overlay from its rows.
 * @param rows - The model's overlay rows.
 * @returns The overlay.
 */
export const overlayFromRows = (
  rows: readonly (typeof overlay.$inferSelect)[],
): Overlay<OpenIds> =>
  overlaySchema.parse(
    Object.fromEntries(rows.map(({ element, status }) => [element, status])),
  );

/**
 * Reassembles a fact record from its rows, parsing it with the contract's `factRecordSchema`, so every stored value is checked to be a trilean value.
 * @param artefactRows - The model's artefact fact rows.
 * @param valueRows - The model's named fact rows.
 * @returns The fact record.
 */
export const factsFromRows = (
  artefactRows: readonly (typeof artefactFacts.$inferSelect)[],
  valueRows: readonly (typeof namedFacts.$inferSelect)[],
): FactRecord =>
  factRecordSchema.parse({
    artefacts: Object.fromEntries(
      artefactRows.map(({ artefact, provided }) => [artefact, provided]),
    ),
    values: Object.fromEntries(
      valueRows.map(({ name, value }) => [name, value]),
    ),
  });

/**
 * Flattens a fact record into rows for one model.
 * @param modelId - The model the facts are about.
 * @param facts - The record.
 * @returns The artefact fact rows and the named fact rows.
 */
export const factRows = (
  modelId: string,
  facts: FactRecord,
): {
  readonly artefacts: readonly (typeof artefactFacts.$inferInsert)[];
  readonly values: readonly (typeof namedFacts.$inferInsert)[];
} => ({
  artefacts: Object.entries(facts.artefacts).map(([artefact, provided]) => ({
    modelId,
    artefact,
    provided,
  })),
  values: Object.entries(facts.values).map(([name, value]) => ({
    modelId,
    name,
    value,
  })),
});
