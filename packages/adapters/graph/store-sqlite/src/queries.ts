import type { Reach } from "@exadev/process-graph-store-contract";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { SqliteDatabase } from "./database.ts";

/**
 * The structural queries of the `GraphStore` contract in SQL, each one recursive query over `transitions`, `elements` and `overlay` (or, for the hierarchy, `relations` and `elements`) through Drizzle's `sql` template. They read the stored `loop` flag rather than the model, so they never load or evaluate it, and they answer exactly as the contract's reference implementation (`readyOf`, `blockedChainOf`, `impactOf`, `childrenOf`, `descendantsOf`, `ancestorsOf`) does, which the conformance kit checks.
 */

/** A query about one element of one model. */
interface ElementQuery {
  readonly modelId: string;
  readonly element: string;
}

/** The element kinds the queries pass through and never report. */
const control = sql`('decision', 'pseudo')`;

/** Whether the overlay records `element` (an SQL expression) as done in `modelId`. */
const isDone = (modelId: string, element: SQL): SQL =>
  sql`EXISTS (SELECT 1 FROM overlay o WHERE o.model_id = ${modelId} AND o.element = ${element} AND o.status = 'done')`;

const reachRow = z.tuple([z.string(), z.number().int().positive()]);
const idRow = z.tuple([z.string()]);

/** Which way a walk follows transitions: from target to source (upstream) or from source to target (downstream). */
interface Direction {
  readonly from: SQL;
  readonly to: SQL;
}

const upstream: Direction = { from: sql.raw("target"), to: sql.raw("source") };
const downstream: Direction = {
  from: sql.raw("source"),
  to: sql.raw("target"),
};

/**
 * Every element not done and not a control element reachable from `element` along non-loop transitions in one direction, expanding only elements that are not done, with the fewest transitions it takes, by that distance and then model order.
 *
 * Distances are capped at the model's element count: no shortest path is longer, and the cap ends the recursion on a model whose transitions cycle without a decision.
 */
const walk = async (
  db: SqliteDatabase,
  { modelId, element }: ElementQuery,
  { from, to }: Direction,
): Promise<readonly Reach[]> => {
  const rows = await db.values(sql`
    WITH RECURSIVE
      bound(n) AS (SELECT count(*) FROM elements WHERE model_id = ${modelId}),
      walk(element, distance) AS (
        SELECT t.${to}, 1 FROM transitions t
          WHERE t.model_id = ${modelId} AND t.${from} = ${element} AND t.loop = 0
        UNION
        SELECT t.${to}, w.distance + 1 FROM walk w
          JOIN transitions t ON t.model_id = ${modelId} AND t.${from} = w.element AND t.loop = 0
          WHERE w.distance < (SELECT n FROM bound)
            AND NOT ${isDone(modelId, sql`w.element`)}
      )
    SELECT w.element, min(w.distance) AS distance
      FROM walk w
      JOIN elements e ON e.model_id = ${modelId} AND e.id = w.element
      WHERE w.element <> ${element}
        AND e.kind NOT IN ${control}
        AND NOT ${isDone(modelId, sql`w.element`)}
      GROUP BY w.element, e.position
      ORDER BY distance, e.position
  `);

  return rows.map((row) => {
    const [reached, distance] = reachRow.parse(row);

    return { element: reached, distance };
  });
};

/**
 * The unfinished work upstream of an element; nothing when the element is done.
 * @param db - The database.
 * @param request - The model and the element, which the caller has checked exist.
 * @returns The chain, by distance and then model order.
 */
export const blockedChain = async (
  db: SqliteDatabase,
  request: ElementQuery,
): Promise<readonly Reach[]> => {
  const [done] = await db.values(
    sql`SELECT ${isDone(request.modelId, sql`${request.element}`)}`,
  );

  return z.tuple([z.number()]).parse(done)[0] === 1
    ? []
    : walk(db, request, upstream);
};

/**
 * The unfinished work downstream of an element, whatever its own state.
 * @param db - The database.
 * @param request - The model and the element, which the caller has checked exist.
 * @returns The impacted elements, by distance and then model order.
 */
export const impact = async (
  db: SqliteDatabase,
  request: ElementQuery,
): Promise<readonly Reach[]> => walk(db, request, downstream);

/**
 * The work that can start now: every element that is not a control element, whose run state is absent or `open`, and from which no unfinished work is reachable upstream through control elements that are not done. That is exactly "its blocked chain is empty": the first unfinished work on any upstream path is reached through control elements alone.
 * @param db - The database.
 * @param modelId - The model, which the caller has checked exists.
 * @returns The ready elements, in model order.
 */
export const ready = async (
  db: SqliteDatabase,
  modelId: string,
): Promise<readonly string[]> => {
  const rows = await db.values(sql`
    WITH RECURSIVE
      behind(start, element) AS (
        SELECT t.target, t.source FROM transitions t
          WHERE t.model_id = ${modelId} AND t.loop = 0
        UNION
        SELECT b.start, t.source FROM behind b
          JOIN elements c ON c.model_id = ${modelId} AND c.id = b.element AND c.kind IN ${control}
          JOIN transitions t ON t.model_id = ${modelId} AND t.target = b.element AND t.loop = 0
          WHERE NOT ${isDone(modelId, sql`b.element`)}
      )
    SELECT e.id FROM elements e
      WHERE e.model_id = ${modelId}
        AND e.kind NOT IN ${control}
        AND NOT EXISTS (
          SELECT 1 FROM overlay o
            WHERE o.model_id = ${modelId} AND o.element = e.id AND o.status IN ('done', 'unknown')
        )
        AND NOT EXISTS (
          SELECT 1 FROM behind b
            JOIN elements p ON p.model_id = ${modelId} AND p.id = b.element
            WHERE b.start = e.id
              AND p.kind NOT IN ${control}
              AND NOT ${isDone(modelId, sql`b.element`)}
        )
      ORDER BY e.position
  `);

  return rows.map((row) => idRow.parse(row)[0]);
};

/** Which way a hierarchy walk follows `child-of` relations: from a parent (`to_id`) to its children (`from_id`), or from a child to its parents. */
const down: Direction = { from: sql.raw("to_id"), to: sql.raw("from_id") };
const up: Direction = { from: sql.raw("from_id"), to: sql.raw("to_id") };

/**
 * Every element reachable from `element` along `child-of` relations in one direction, with the fewest relations it takes, by that distance and then model order. The element itself is never reported.
 *
 * Distances are capped at the model's element count: no shortest path is longer, and the cap ends the recursion on a cycle of `child-of` relations.
 */
const hierarchyWalk = async (
  db: SqliteDatabase,
  { modelId, element }: ElementQuery,
  { from, to }: Direction,
): Promise<readonly Reach[]> => {
  const rows = await db.values(sql`
    WITH RECURSIVE
      bound(n) AS (SELECT count(*) FROM elements WHERE model_id = ${modelId}),
      walk(element, distance) AS (
        SELECT r.${to}, 1 FROM relations r
          WHERE r.model_id = ${modelId} AND r.kind = 'child-of' AND r.${from} = ${element}
        UNION
        SELECT r.${to}, w.distance + 1 FROM walk w
          JOIN relations r ON r.model_id = ${modelId} AND r.kind = 'child-of' AND r.${from} = w.element
          WHERE w.distance < (SELECT n FROM bound)
      )
    SELECT w.element, min(w.distance) AS distance
      FROM walk w
      JOIN elements e ON e.model_id = ${modelId} AND e.id = w.element
      WHERE w.element <> ${element}
      GROUP BY w.element, e.position
      ORDER BY distance, e.position
  `);

  return rows.map((row) => {
    const [reached, distance] = reachRow.parse(row);

    return { element: reached, distance };
  });
};

/**
 * The direct children of an element: every element related to it by `child-of`, other than itself.
 * @param db - The database.
 * @param request - The model and the element, which the caller has checked exist.
 * @returns The children, in model order.
 */
export const children = async (
  db: SqliteDatabase,
  request: ElementQuery,
): Promise<readonly string[]> => {
  const { modelId, element } = request;
  const rows = await db.values(sql`
    SELECT r.from_id FROM relations r
      JOIN elements e ON e.model_id = ${modelId} AND e.id = r.from_id
      WHERE r.model_id = ${modelId} AND r.kind = 'child-of' AND r.to_id = ${element}
        AND r.from_id <> ${element}
      ORDER BY e.position
  `);

  return rows.map((row) => idRow.parse(row)[0]);
};

/**
 * Everything beneath an element along `child-of` relations.
 * @param db - The database.
 * @param request - The model and the element, which the caller has checked exist.
 * @returns The descendants, by distance and then model order.
 */
export const descendants = async (
  db: SqliteDatabase,
  request: ElementQuery,
): Promise<readonly Reach[]> => hierarchyWalk(db, request, down);

/**
 * Everything above an element along `child-of` relations.
 * @param db - The database.
 * @param request - The model and the element, which the caller has checked exist.
 * @returns The ancestors, by distance and then model order.
 */
export const ancestors = async (
  db: SqliteDatabase,
  request: ElementQuery,
): Promise<readonly Reach[]> => hierarchyWalk(db, request, up);
