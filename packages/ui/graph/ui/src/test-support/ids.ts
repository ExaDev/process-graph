import type { Model } from "@exadev/process-graph-schema";
import type { order } from "./order.ts";

/** The identifier spaces of the order fixture. */
export type OrderIds = typeof order extends Model<infer I> ? I : never;
