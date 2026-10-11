import {
  emptyFactRecord,
  loopTransitions,
  type FactRecord,
} from "@exadev/process-graph-domain";
import type { Model, OpenIds, Overlay } from "@exadev/process-graph-schema";
import {
  ChangeFeed,
  checkStored,
  emptyModel,
  factIssues,
  factsWithin,
  GraphStoreError,
  mergeBoundItems,
  mergeFacts,
  mergeRelations,
  overlayWithin,
  relationIssues,
  relationsWithin,
  withoutFacts,
  type ChangeKind,
  type GraphStore,
  type Relation,
  type StoredModel,
} from "@exadev/process-graph-store-contract";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  inTransaction,
  sequentially,
  serialised,
  type Exclusive,
  type SqliteDatabase,
} from "./database.ts";
import { migrate } from "./migrate.ts";
import {
  ancestors,
  blockedChain,
  children,
  descendants,
  impact,
  ready,
} from "./queries.ts";
import {
  factRows,
  factsFromRows,
  fromRows,
  overlayFromRows,
  toRows,
  type ModelInserts,
} from "./rows.ts";
import {
  actions,
  artefactFacts,
  artefacts,
  elements,
  events,
  fragments,
  models,
  namedFacts,
  overlay as overlayTable,
  participants,
  projections,
  relations as relationsTable,
  sequences,
  transitions,
} from "./tables.ts";

/** The tables that hold a model's own records and the relations kept beside it, every one keyed by `modelId`. */
const recordTables = [
  participants,
  events,
  actions,
  artefacts,
  elements,
  transitions,
  fragments,
  projections,
  relationsTable,
] as const;

/** The tables that hold a model's fact record, both keyed by `modelId`. */
const factTables = [artefactFacts, namedFacts] as const;

/** The name of the store-wide revision sequence's row in `sequences`. */
const revisionSequence = "revision";

/** What `createSqliteGraphStore` needs. */
export interface SqliteGraphStoreOptions {
  /** Any Drizzle SQLite database, migrated or not. */
  readonly db: SqliteDatabase;
  /**
   * Runs each store operation with the database to itself. Defaults to serialising this store's operations in call order, which is enough when one store owns the connection. A host that shares the database across contexts (tabs, processes) supplies one that also holds its cross-context lock.
   */
  readonly exclusive?: Exclusive;
  /** The feed committed changes are published to. A host that bridges other contexts' changes in passes its own. */
  readonly feed?: ChangeFeed;
}

/**
 * A `GraphStore` over SQLite through Drizzle. It migrates the database on its first operation, keeps every model as rows (see `tables.ts` and `rows.ts`), checks every write with the contract's `checkStored` before committing it, and answers the structural queries with recursive SQL.
 *
 * Writes rewrite the model's rows inside one transaction, so a failed check or an aborted signal leaves the previous rows in place.
 * @param options - The database, and optionally the exclusivity and feed a host provides.
 * @returns The store, ready to serve with `createGraphStoreRouter`.
 */
export const createSqliteGraphStore = (
  options: SqliteGraphStoreOptions,
): GraphStore => {
  const { db, exclusive = serialised(), feed = new ChangeFeed() } = options;
  let migrated: Promise<void> | undefined;

  /** Runs an operation exclusively on a migrated database. */
  const operation = async <T>(work: () => Promise<T>): Promise<T> =>
    exclusive(async () => {
      migrated ??= migrate(db);
      await migrated;

      return work();
    });

  const nextRevision = async (): Promise<number> => {
    const [row] = await db
      .insert(sequences)
      .values({ name: revisionSequence, value: 1 })
      .onConflictDoUpdate({
        target: sequences.name,
        set: { value: sql`${sequences.value} + 1` },
      })
      .returning({ value: sequences.value });

    return z.object({ value: z.number() }).parse(row).value;
  };

  const revisionOf = async (modelId: string): Promise<number | undefined> => {
    const [row] = await db
      .select({ revision: models.revision })
      .from(models)
      .where(eq(models.id, modelId));

    return row?.revision;
  };

  const requireModel = async (modelId: string): Promise<void> => {
    if ((await revisionOf(modelId)) === undefined) {
      throw new GraphStoreError({ kind: "not-found", modelId });
    }
  };

  const requireElement = async (
    modelId: string,
    element: string,
  ): Promise<void> => {
    await requireModel(modelId);
    const [row] = await db
      .select({ id: elements.id })
      .from(elements)
      .where(and(eq(elements.modelId, modelId), eq(elements.id, element)));
    if (row === undefined) {
      throw new GraphStoreError({ kind: "not-found", modelId, element });
    }
  };

  const readOverlay = async (modelId: string): Promise<Overlay<OpenIds>> =>
    overlayFromRows(
      await db
        .select()
        .from(overlayTable)
        .where(eq(overlayTable.modelId, modelId)),
    );

  const readRelations = async (modelId: string): Promise<readonly Relation[]> =>
    db
      .select({
        kind: relationsTable.kind,
        from: relationsTable.from,
        to: relationsTable.to,
      })
      .from(relationsTable)
      .where(eq(relationsTable.modelId, modelId))
      .orderBy(asc(relationsTable.position));

  const readFacts = async (modelId: string): Promise<FactRecord> =>
    factsFromRows(
      await db
        .select()
        .from(artefactFacts)
        .where(eq(artefactFacts.modelId, modelId))
        .orderBy(asc(artefactFacts.artefact)),
      await db
        .select()
        .from(namedFacts)
        .where(eq(namedFacts.modelId, modelId))
        .orderBy(asc(namedFacts.name)),
    );

  /** Replaces a model's fact rows with a record's; run inside the caller's transaction. */
  const replaceFacts = async (
    modelId: string,
    facts: FactRecord,
  ): Promise<void> => {
    await sequentially(
      factTables.map(
        (table) => async () =>
          db.delete(table).where(eq(table.modelId, modelId)),
      ),
    );
    const rows = factRows(modelId, facts);
    if (rows.artefacts.length > 0) {
      await db.insert(artefactFacts).values([...rows.artefacts]);
    }
    if (rows.values.length > 0) {
      await db.insert(namedFacts).values([...rows.values]);
    }
  };

  const read = async (modelId: string): Promise<StoredModel> => {
    const [model] = await db
      .select()
      .from(models)
      .where(eq(models.id, modelId));
    if (model === undefined) {
      throw new GraphStoreError({ kind: "not-found", modelId });
    }
    const rows = {
      model,
      participants: await db
        .select()
        .from(participants)
        .where(eq(participants.modelId, modelId))
        .orderBy(asc(participants.position)),
      events: await db
        .select()
        .from(events)
        .where(eq(events.modelId, modelId))
        .orderBy(asc(events.position)),
      actions: await db
        .select()
        .from(actions)
        .where(eq(actions.modelId, modelId))
        .orderBy(asc(actions.position)),
      artefacts: await db
        .select()
        .from(artefacts)
        .where(eq(artefacts.modelId, modelId))
        .orderBy(asc(artefacts.position)),
      elements: await db
        .select()
        .from(elements)
        .where(eq(elements.modelId, modelId))
        .orderBy(asc(elements.position)),
      transitions: await db
        .select()
        .from(transitions)
        .where(eq(transitions.modelId, modelId))
        .orderBy(asc(transitions.position)),
      fragments: await db
        .select()
        .from(fragments)
        .where(eq(fragments.modelId, modelId))
        .orderBy(asc(fragments.position)),
      projections: await db
        .select()
        .from(projections)
        .where(eq(projections.modelId, modelId))
        .orderBy(asc(projections.position)),
    };

    return {
      modelId,
      revision: model.revision,
      model: fromRows(rows),
      overlay: await readOverlay(modelId),
      facts: await readFacts(modelId),
    };
  };

  const removeRecords = async (modelId: string): Promise<void> =>
    sequentially(
      recordTables.map(
        (table) => async () =>
          db.delete(table).where(eq(table.modelId, modelId)),
      ),
    );

  /** Inserts a model's record rows, skipping the tables it has no records for (an insert needs at least one row). */
  const insertAll = async (rows: ModelInserts): Promise<void> =>
    sequentially([
      ...(rows.participants.length > 0
        ? [async () => db.insert(participants).values([...rows.participants])]
        : []),
      ...(rows.events.length > 0
        ? [async () => db.insert(events).values([...rows.events])]
        : []),
      ...(rows.actions.length > 0
        ? [async () => db.insert(actions).values([...rows.actions])]
        : []),
      ...(rows.artefacts.length > 0
        ? [async () => db.insert(artefacts).values([...rows.artefacts])]
        : []),
      ...(rows.elements.length > 0
        ? [async () => db.insert(elements).values([...rows.elements])]
        : []),
      ...(rows.transitions.length > 0
        ? [async () => db.insert(transitions).values([...rows.transitions])]
        : []),
      ...(rows.fragments.length > 0
        ? [async () => db.insert(fragments).values([...rows.fragments])]
        : []),
      ...(rows.projections.length > 0
        ? [async () => db.insert(projections).values([...rows.projections])]
        : []),
    ]);

  /** Everything one write stores and reports. */
  interface Write {
    readonly modelId: string;
    readonly kind: ChangeKind;
    readonly model: Model<OpenIds>;
    readonly overlay: Overlay<OpenIds>;
    readonly relations: readonly Relation[];
    readonly facts: FactRecord;
    readonly signal: AbortSignal | undefined;
  }

  /** Replaces a model's rows, overlay, relations and facts in one transaction and publishes the change once it commits. */
  const write = async ({
    modelId,
    kind,
    model,
    overlay,
    relations,
    facts,
    signal,
  }: Write): Promise<number> => {
    checkStored(model, overlay);
    const issues = [
      ...relationIssues(model, relations),
      ...factIssues(model, facts),
    ];
    if (issues.length > 0) {
      throw new GraphStoreError({ kind: "invalid", issues });
    }
    const revision = await inTransaction(db, async () => {
      const taken = await nextRevision();
      const rows = toRows(
        modelId,
        model,
        taken,
        new Set(loopTransitions(model)),
      );
      await removeRecords(modelId);
      await db.delete(overlayTable).where(eq(overlayTable.modelId, modelId));
      await db
        .insert(models)
        .values(rows.model)
        .onConflictDoUpdate({
          target: models.id,
          set: { revision: rows.model.revision, views: rows.model.views },
        });
      await insertAll(rows);
      const entries = Object.entries(overlay).flatMap(([element, status]) =>
        status === undefined ? [] : [{ modelId, element, status }],
      );
      if (entries.length > 0) {
        await db.insert(overlayTable).values(entries);
      }
      if (relations.length > 0) {
        await db.insert(relationsTable).values(
          relations.map((relation, position) => ({
            modelId,
            ...relation,
            position,
          })),
        );
      }
      await replaceFacts(modelId, facts);
      signal?.throwIfAborted();

      return taken;
    });
    feed.publish({ modelId, kind, revision });

    return revision;
  };

  /** Replaces a model's fact record in one transaction, after checking it names only artefacts the model declares, and publishes the change once it commits. */
  const writeFacts = async ({
    modelId,
    model,
    facts,
    signal,
  }: {
    readonly modelId: string;
    readonly model: Model<OpenIds>;
    readonly facts: FactRecord;
    readonly signal: AbortSignal | undefined;
  }): Promise<number> => {
    const issues = factIssues(model, facts);
    if (issues.length > 0) {
      throw new GraphStoreError({ kind: "invalid", issues });
    }
    const revision = await inTransaction(db, async () => {
      const taken = await nextRevision();
      await db
        .update(models)
        .set({ revision: taken })
        .where(eq(models.id, modelId));
      await replaceFacts(modelId, facts);
      signal?.throwIfAborted();

      return taken;
    });
    feed.publish({ modelId, kind: "facts", revision });

    return revision;
  };

  return {
    feed,
    listModels: async () =>
      operation(async () =>
        db
          .select({ modelId: models.id, revision: models.revision })
          .from(models)
          .orderBy(asc(models.id)),
      ),
    saveModel: async ({ modelId, model, signal }) =>
      operation(async () => {
        const stored = (await revisionOf(modelId)) !== undefined;

        return write({
          modelId,
          kind: "saved",
          model,
          overlay: overlayWithin(
            model,
            stored ? await readOverlay(modelId) : {},
          ),
          relations: relationsWithin(
            model,
            stored ? await readRelations(modelId) : [],
          ),
          facts: factsWithin(
            model,
            stored ? await readFacts(modelId) : emptyFactRecord,
          ),
          signal,
        });
      }),
    loadModel: async ({ modelId }) => operation(async () => read(modelId)),
    deleteModel: async ({ modelId, signal }) =>
      operation(async () => {
        if ((await revisionOf(modelId)) === undefined) {
          return undefined;
        }
        const revision = await inTransaction(db, async () => {
          const taken = await nextRevision();
          await removeRecords(modelId);
          await db
            .delete(overlayTable)
            .where(eq(overlayTable.modelId, modelId));
          await replaceFacts(modelId, emptyFactRecord);
          await db.delete(models).where(eq(models.id, modelId));
          signal?.throwIfAborted();

          return taken;
        });
        feed.publish({ modelId, kind: "deleted", revision });

        return revision;
      }),
    applyOverlay: async ({ modelId, overlay, signal }) =>
      operation(async () => {
        const stored = await read(modelId);
        const merged = { ...stored.overlay, ...overlay };
        checkStored(stored.model, merged);
        const named = Object.keys(overlay);
        const revision = await inTransaction(db, async () => {
          const taken = await nextRevision();
          await db
            .update(models)
            .set({ revision: taken })
            .where(eq(models.id, modelId));
          await db
            .delete(overlayTable)
            .where(
              and(
                eq(overlayTable.modelId, modelId),
                inArray(overlayTable.element, named),
              ),
            );
          const entries = Object.entries(overlay).flatMap(
            ([element, status]) =>
              status === undefined ? [] : [{ modelId, element, status }],
          );
          if (entries.length > 0) {
            await db.insert(overlayTable).values(entries);
          }
          signal?.throwIfAborted();

          return taken;
        });
        feed.publish({ modelId, kind: "overlay", revision });

        return revision;
      }),
    readFacts: async ({ modelId }) =>
      operation(async () => {
        const revision = await revisionOf(modelId);
        if (revision === undefined) {
          throw new GraphStoreError({ kind: "not-found", modelId });
        }

        return { modelId, revision, facts: await readFacts(modelId) };
      }),
    setFacts: async ({ modelId, facts, signal }) =>
      operation(async () => {
        const stored = await read(modelId);

        return writeFacts({
          modelId,
          model: stored.model,
          facts: mergeFacts(stored.facts, facts),
          signal,
        });
      }),
    clearFacts: async ({ modelId, facts, signal }) =>
      operation(async () => {
        const stored = await read(modelId);

        return writeFacts({
          modelId,
          model: stored.model,
          facts: withoutFacts(stored.facts, facts),
          signal,
        });
      }),
    upsertItems: async ({ modelId, items, signal }) =>
      operation(async () => {
        const stored =
          (await revisionOf(modelId)) === undefined
            ? {
                model: emptyModel,
                overlay: {},
                relations: [],
                facts: emptyFactRecord,
              }
            : {
                ...(await read(modelId)),
                relations: await readRelations(modelId),
              };

        return write({
          modelId,
          kind: "items",
          ...mergeBoundItems(stored.model, stored.overlay, items),
          relations: mergeRelations(stored.relations, items.relations ?? []),
          facts: stored.facts,
          signal,
        });
      }),
    relations: async ({ modelId }) =>
      operation(async () => {
        await requireModel(modelId);

        return readRelations(modelId);
      }),
    children: async ({ modelId, element }) =>
      operation(async () => {
        await requireElement(modelId, element);

        return children(db, { modelId, element });
      }),
    descendants: async ({ modelId, element }) =>
      operation(async () => {
        await requireElement(modelId, element);

        return descendants(db, { modelId, element });
      }),
    ancestors: async ({ modelId, element }) =>
      operation(async () => {
        await requireElement(modelId, element);

        return ancestors(db, { modelId, element });
      }),
    ready: async ({ modelId }) =>
      operation(async () => {
        await requireModel(modelId);

        return ready(db, modelId);
      }),
    blockedChain: async ({ modelId, element }) =>
      operation(async () => {
        await requireElement(modelId, element);

        return blockedChain(db, { modelId, element });
      }),
    impact: async ({ modelId, element }) =>
      operation(async () => {
        await requireElement(modelId, element);

        return impact(db, { modelId, element });
      }),
    revisionOf: async ({ modelId }) =>
      operation(async () => revisionOf(modelId)),
  };
};
