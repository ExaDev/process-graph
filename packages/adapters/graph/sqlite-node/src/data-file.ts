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

/** Where a store's data file lives, and how much of its path the caller owns. */
export interface DataFileOptions {
  /**
   * Whether the directory is the caller's own, such as an application's default data directory or one a host keeps under its own home, which is created private and kept private. A directory someone else chose, such as a path a user names on a command line, is created when missing but never has its mode changed.
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
 * Makes a data file ready for `openNodeGraphStore` to open, so a store holding synced work is never readable by other users on the host. Call it before opening the store; it does not open the database itself.
 *
 * The directory is created when missing (with any missing parents), with `privateDirectoryMode` when it is the caller's own. The database file is created with `privateFileMode` when missing, before SQLite opens it, so the file and the `-wal` and `-shm` files SQLite derives from it are never readable by others, whatever the umask. A file that already exists is left alone unless the directory is the caller's own; there, an existing directory or store file (database, `-wal` or `-shm`) that group or others can read is narrowed to the private mode. On Windows, where file modes mean nothing, only the directory is created.
 * @param path - The database file; not `":memory:"`, which has no file.
 * @param options - Whether the caller owns the directory, and the platform.
 * @returns One warning line naming what was narrowed, for the caller to show, or nothing when nothing was.
 * @throws Error from the file system when the directory or file cannot be created or its mode read or changed.
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
