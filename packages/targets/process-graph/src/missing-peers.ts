/**
 * The optional peer dependencies the command line imports. `process-graph` declares them optional so that installing it for its root entry stays light, which means the bin can start without them; it checks for these first and says what to install rather than failing on the first missing import. The smoke test runs the packed bin where none is installed and expects exactly these to be named, so a peer the command line starts needing that is missing here fails that test.
 */
export const commandLinePeers = [
  "@orpc/client",
  "@orpc/contract",
  "@orpc/server",
  "commander",
  "drizzle-orm",
] as const;

/**
 * The peers that do not resolve.
 * @param peers - The package names to look for.
 * @param resolves - Whether a package name resolves from the bin's own location.
 * @returns The names that do not, in the order given.
 */
export const missingPeers = (
  peers: readonly string[],
  resolves: (name: string) => boolean,
): string[] => peers.filter((name) => !resolves(name));

/** The command each package manager installs a package with, keyed by the name its `npm_config_user_agent` starts with. */
const installCommands: ReadonlyMap<string, string> = new Map([
  ["npm", "npm install"],
  ["pnpm", "pnpm add"],
  ["yarn", "yarn add"],
  ["bun", "bun add"],
]);

/** npm's command, for a bin run directly or by a package manager not listed. */
const defaultInstallCommand = "npm install";

/**
 * The command that installs packages with the package manager that ran the bin.
 * @param userAgent - `npm_config_user_agent`, which every package manager sets for the processes it runs (`pnpm/12.4.1 npm/? node/v26.8.1 darwin arm64`), or `undefined` when the bin was run directly.
 * @param packages - The `name@version` specifiers to install.
 * @returns The command, with npm's when the package manager is not recognised.
 */
export const installCommand = (
  userAgent: string | undefined,
  packages: readonly string[],
): string => {
  const manager = userAgent?.split("/", 1)[0];
  const command =
    (manager === undefined ? undefined : installCommands.get(manager)) ??
    defaultInstallCommand;

  return [command, ...packages].join(" ");
};

/**
 * The one message the bin prints when peers are missing.
 * @param missing - The missing package names.
 * @param versions - The version `process-graph` declares for each peer, by name.
 * @param userAgent - `npm_config_user_agent`, to pick the install command.
 * @returns The message, ending in a newline.
 * @throws Error when a missing package is not one of the declared peers, which is a packaging mistake rather than the user's.
 */
export const missingPeersMessage = (
  missing: readonly string[],
  versions: ReadonlyMap<string, string>,
  userAgent: string | undefined,
): string => {
  const specifiers = missing.map((name) => {
    const version = versions.get(name);
    if (version === undefined) {
      throw new Error(`process-graph declares no peer dependency on ${name}`);
    }

    return `${name}@${version}`;
  });

  return [
    `process-graph: the command line needs these optional peer dependencies, which are not installed: ${missing.join(", ")}.`,
    `Install them beside process-graph: ${installCommand(userAgent, specifiers)}`,
    "",
  ].join("\n");
};
