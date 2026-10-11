import {
  elementKinds,
  fragmentOperators,
  messageModes,
  notations,
  overlayStatuses,
  participantKinds,
  pseudoRoles,
} from "@exadev/process-graph-schema";
import { relationKinds } from "@exadev/process-graph-store-contract";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * The storage projection of the process model. Every record a model declares is one row keyed by its model and its id, with `position` keeping the model's declared order, so a model loads back exactly as it was saved. Enumerated columns take their values from graph-schema's own vocabulary, and nested values (lists, extensions, conditions) are JSON text, typed `unknown` here because `rows.ts` checks them with the model schema on every read. Rows are never the contract's shape: `rows.ts` maps them to the model and back.
 *
 * No foreign keys are declared: SQLite enforces them only on connections that enable them, which a store cannot assume of the driver it is given, so the store keeps a model's rows together itself by writing and deleting them in one transaction.
 */

/** The store-wide revision sequence: one row, named so it reads as what it is. */
export const sequences = sqliteTable("sequences", {
  name: text("name").primaryKey(),
  value: integer("value").notNull(),
});

/** One row per stored model: its revision and its layout. */
export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  views: text("views", { mode: "json" }),
});

export const participants = sqliteTable(
  "participants",
  {
    modelId: text("model_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    kind: text("kind", { enum: participantKinds }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.id] })],
);

export const events = sqliteTable(
  "events",
  {
    modelId: text("model_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    payload: text("payload", { mode: "json" }),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.id] })],
);

export const actions = sqliteTable(
  "actions",
  {
    modelId: text("model_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.id] })],
);

export const artefacts = sqliteTable(
  "artefacts",
  {
    modelId: text("model_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    deliverable: integer("deliverable", { mode: "boolean" }),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.id] })],
);

/**
 * Every element kind in one table, so the structural queries traverse a single relation. A column a kind does not have is null on its rows; `rows.ts` reads only the columns of the row's kind.
 */
export const elements = sqliteTable(
  "elements",
  {
    modelId: text("model_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    kind: text("kind", { enum: elementKinds }).notNull(),
    label: text("label"),
    actor: text("actor"),
    action: text("action"),
    source: text("source"),
    affects: text("affects", { mode: "json" }),
    consumes: text("consumes", { mode: "json" }),
    produces: text("produces", { mode: "json" }),
    parent: text("parent"),
    entry: text("entry"),
    exit: text("exit"),
    role: text("role", { enum: pseudoRoles }),
    from: text("from_actor"),
    to: text("to_actor"),
    mode: text("mode", { enum: messageModes }),
    event: text("event"),
    extensions: text("extensions", { mode: "json" }),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.id] })],
);

/** Transitions, with `loop` recording whether graph-domain counts the transition as a decision's loop edge, so the recursive queries can leave it out without loading the model. */
export const transitions = sqliteTable(
  "transitions",
  {
    modelId: text("model_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    trigger: text("trigger"),
    guard: text("guard"),
    condition: text("condition", { mode: "json" }),
    effect: text("effect"),
    loop: integer("loop", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.modelId, table.id] }),
    // The recursive queries walk transitions both ways from an element.
    index("transitions_by_target").on(table.modelId, table.target),
    index("transitions_by_source").on(table.modelId, table.source),
  ],
);

export const fragments = sqliteTable(
  "fragments",
  {
    modelId: text("model_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    operator: text("operator", { enum: fragmentOperators }).notNull(),
    operands: text("operands", { mode: "json" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.id] })],
);

/** Projections, keyed by position because the model does not require their ids to be unique. */
export const projections = sqliteTable(
  "projections",
  {
    modelId: text("model_id").notNull(),
    position: integer("position").notNull(),
    id: text("id").notNull(),
    notation: text("notation", { enum: notations }).notNull(),
    subject: text("subject"),
    scenario: text("scenario", { mode: "json" }),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.position] })],
);

/** Run state, one row per element that has any. */
export const overlay = sqliteTable(
  "overlay",
  {
    modelId: text("model_id").notNull(),
    element: text("element").notNull(),
    status: text("status", { enum: overlayStatuses }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.element] })],
);

/**
 * Relations kept beside a model, one row per kind and pair of ends, so a relation sent twice is stored once, with `position` keeping the order relations were first stored. The ends are identifiers of the model's elements or participants, by kind.
 */
export const relations = sqliteTable(
  "relations",
  {
    modelId: text("model_id").notNull(),
    kind: text("kind", { enum: relationKinds }).notNull(),
    from: text("from_id").notNull(),
    to: text("to_id").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    // The key also serves the walk from a child up to its parents, which starts from `from_id`.
    primaryKey({
      columns: [table.modelId, table.kind, table.from, table.to],
    }),
    // The walk from a parent down to its children starts from `to_id`.
    index("relations_by_to").on(table.modelId, table.kind, table.to),
  ],
);
