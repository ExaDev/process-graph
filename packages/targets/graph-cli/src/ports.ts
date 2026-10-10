import type { Facts } from "@exadev/process-graph-domain";
import type { GraphSourceClient } from "@exadev/process-graph-source-contract";
import type { GraphStoreClient } from "@exadev/process-graph-store-contract";

/** A store opened for one command, and how to release it. */
export interface OpenedStore {
  /** The store, over whatever transport the opener chose. */
  readonly client: GraphStoreClient;
  /** Releases the store. Called once, after the command, whether it succeeded or not. */
  readonly close: () => void | Promise<void>;
}

/**
 * Everything the command line touches outside itself. Commands read and write only through these, so the whole command surface runs in a test, or inside another program such as Switchboard, with no process, file system or network of its own. `nodePorts` supplies them for a real process.
 */
export interface CliPorts {
  /** Writes text to standard output, exactly as given. */
  readonly stdout: (text: string) => void;
  /** Writes text to standard error, exactly as given. */
  readonly stderr: (text: string) => void;
  /** Opens the store kept at a data path. */
  readonly openStore: (path: string) => OpenedStore | Promise<OpenedStore>;
  /** The data path used when `--data` is not given. */
  readonly defaultDataPath: string;
  /**
   * The source that serves scopes with an identifier prefix, such as `github` for `github:owner/repo`, or `undefined` when no source has that prefix.
   * @param prefix - The part of a scope identifier before its first colon.
   */
  readonly source: (prefix: string) => GraphSourceClient | undefined;
  /**
   * Reads a text file, for `validate <file>`.
   * @param path - The file to read.
   * @param signal - Aborts the read.
   */
  readonly readFile: (
    path: string,
    signal: AbortSignal | undefined,
  ) => Promise<string>;
  /** The facts that decision conditions read, and which input artefacts are provided. */
  readonly facts: Facts;
  /** Aborts every store and source call a command makes. */
  readonly signal: AbortSignal | undefined;
}
