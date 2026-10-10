import { execFile } from "node:child_process";
import { GraphSourceError } from "@exadev/process-graph-source-contract";
import type { GitHubTokenPort } from "./graphql.ts";

/** Runs `gh auth token` and resolves with its standard output. */
const ghAuthToken = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile("gh", ["auth", "token"], (error, stdout) => {
      if (error === null) {
        resolve(stdout);
      } else {
        reject(new Error("gh auth token failed", { cause: error }));
      }
    });
  });

/** Where `githubTokenFromEnvironment` looks. Both are ports, so a test supplies its own. */
export interface EnvironmentTokenOptions {
  /** The environment to read `GITHUB_TOKEN` from; `process.env` when absent. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Runs `gh auth token`; the GitHub CLI when absent. */
  readonly runGh?: () => Promise<string>;
}

/**
 * A token port for Node that uses `GITHUB_TOKEN` when it is set and not empty, and otherwise the token the GitHub CLI holds (`gh auth token`), asked for once and reused. The same token serves every owner. The token is never logged, and an error from the CLI is reported without its output.
 * @param options - The environment and the CLI runner, for tests.
 * @returns The token port.
 */
export const githubTokenFromEnvironment = (
  options: EnvironmentTokenOptions = {},
): GitHubTokenPort => {
  const env = options.env ?? process.env;
  const runGh = options.runGh ?? ghAuthToken;
  const fromEnvironment = env.GITHUB_TOKEN;
  let fromCli: Promise<string> | undefined;

  return async () => {
    if (fromEnvironment !== undefined && fromEnvironment !== "") {
      return fromEnvironment;
    }
    fromCli ??= runGh().then(
      (output) => {
        const token = output.trim();
        if (token === "") {
          throw new GraphSourceError({
            kind: "unauthorised",
            message: "gh auth token printed no token; run gh auth login",
          });
        }

        return token;
      },
      (error: unknown) => {
        throw new GraphSourceError(
          {
            kind: "unauthorised",
            message:
              "no GitHub token: GITHUB_TOKEN is not set and gh auth token failed; set GITHUB_TOKEN or run gh auth login",
          },
          { cause: error },
        );
      },
    );

    return fromCli;
  };
};
