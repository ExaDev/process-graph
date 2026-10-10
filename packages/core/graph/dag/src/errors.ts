import type { NodeId } from "./dag.ts";

/**
 * Thrown when an operation that is only defined on an acyclic graph is given one that contains a cycle.
 */
export class CycleError<Id extends NodeId> extends Error {
  /**
   * One closed path per strongly connected component that contains a cycle, exactly as `findCycles` reports them.
   */
  readonly cycles: readonly (readonly Id[])[];

  /**
   * @param cycles - The cycles found, as returned by `findCycles`. Must not be empty.
   */
  constructor(cycles: readonly (readonly Id[])[]) {
    super(
      `The graph contains a cycle: ${cycles.map((path) => path.join(" -> ")).join("; ")}`,
    );
    this.name = "CycleError";
    this.cycles = cycles;
  }
}

/**
 * Thrown when an operation is asked about an id that is not a node of the graph it was given.
 */
export class UnknownNodeError<Id extends NodeId> extends Error {
  /**
   * The id that is not a node of the graph.
   */
  readonly id: Id;

  /**
   * @param id - The id that is not a node of the graph.
   */
  constructor(id: Id) {
    super(`"${String(id)}" is not a node of the graph`);
    this.name = "UnknownNodeError";
    this.id = id;
  }
}
