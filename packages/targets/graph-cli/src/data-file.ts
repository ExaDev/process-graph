import { chmodSync, closeSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** The data directory's mode: only its owner may list or enter it, since the store holds synced work (titles, relationships) that other users on the host must not read. */
export const privateDirectoryMode = 0o700;

/** The data file's mode: only its owner may read or write it. SQLite creates the `-wal` and `-shm` files beside it with the same mode on Unix. */
export const privateFileMode = 0o600;

/** The permission bits of a file mode, without its type. */
const permissionBits = 0o777;

/** The bits that give the file's group or anyone else any access. */
const groupAndOtherBits = 0o077;

/** Where a store's data file lives, and how much of its path the command line owns. */
export interface DataFileOptions {
  /**
   * Whether the directory is the command line's own default, which it creates private and keeps private. A directory the user named (`--data` or `PROCESS_GRAPH_DATA`) is created when missing but never has its mode changed.
   */
  readonly ownsDirectory: boolean;
  /** The platform; on Windows, file modes mean nothing and nothing is set. */
  readonly platform: NodeJS.Platform;
}

/** The SQLite files a store at `path` uses: the database and its write-ahead log and shared-memory index. */
const storeFiles = (path: string): readonly string[] => [
  path,
  `${path}-wal`,
  `${path}-shm`,
];

/** Whether an error is the file system's report that a path does not exist, or already does. */
const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

/**
 * Narrows a path's mode to `mode` when its group or others have any access.
 * @param path - The path.
 * @param mode - The private mode it should have.
 * @returns Whether the mode was changed; `false` too when the path does not exist.
 */
const tighten = (path: string, mode: number): boolean => {
  let current: number;
  try {
    current = statSync(path).mode & permissionBits;
  } catch (error: unknown) {
    if (hasCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
  if ((current & groupAndOtherBits) === 0) {
    return false;
  }
  chmodSync(path, mode);

  return true;
};

/**
 * Makes a data file ready for SQLite to open. The directory is created when missing, private when it is the command line's own. The database file is created private when missing, before SQLite opens it, so the file and the sidecars SQLite derives from it are never readable by others, whatever the umask; a file that already exists is left alone unless the directory is the command line's own. In its own directory, an existing directory or store file that group or others can read is narrowed to the private mode.
 * @param path - The database file.
 * @param options - How much of the path the command line owns, and the platform.
 * @returns One warning line naming what was narrowed, or nothing.
 */
export const prepareDataFile = (
  path: string,
  options: DataFileOptions,
): readonly string[] => {
  const directory = dirname(path);
  if (options.platform === "win32") {
    mkdirSync(directory, { recursive: true });

    return [];
  }
  mkdirSync(
    directory,
    options.ownsDirectory
      ? { recursive: true, mode: privateDirectoryMode }
      : { recursive: true },
  );
  try {
    closeSync(openSync(path, "wx", privateFileMode));
  } catch (error: unknown) {
    if (!hasCode(error, "EEXIST")) {
      throw error;
    }
  }
  if (!options.ownsDirectory) {
    return [];
  }
  const narrowed = [
    ...(tighten(directory, privateDirectoryMode) ? [directory] : []),
    ...storeFiles(path).filter((file) => tighten(file, privateFileMode)),
  ];

  return narrowed.length === 0
    ? []
    : [
        `made ${narrowed.join(", ")} readable by its owner only, since other users could read the synced work in it`,
      ];
};
