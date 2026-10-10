import { describe, expect, test } from "vitest";
import { githubTokenFromEnvironment } from "./node.ts";

const tokenPrintedByGh = "token-from-gh";

describe("githubTokenFromEnvironment", () => {
  test("uses GITHUB_TOKEN when it is set, without running gh", async () => {
    const port = githubTokenFromEnvironment({
      env: { GITHUB_TOKEN: "token-from-env" },
      runGh: async () => Promise.reject(new Error("gh must not run")),
    });
    await expect(port("ExaDev", undefined)).resolves.toBe("token-from-env");
  });

  test("asks gh once when GITHUB_TOKEN is absent or empty, trimming its output", async () => {
    let runs = 0;
    const port = githubTokenFromEnvironment({
      env: { GITHUB_TOKEN: "" },
      runGh: async () => {
        runs += 1;

        return Promise.resolve(`${tokenPrintedByGh}\n`);
      },
    });
    await expect(port("ExaDev", undefined)).resolves.toBe(tokenPrintedByGh);
    await expect(port("Mearman", undefined)).resolves.toBe(tokenPrintedByGh);
    expect(runs).toBe(1);
  });

  test("reports a failing gh as unauthorised, without gh's output", async () => {
    const port = githubTokenFromEnvironment({
      env: {},
      runGh: async () => Promise.reject(new Error("gh: secret-looking output")),
    });
    const failure = port("ExaDev", undefined);
    await expect(failure).rejects.toMatchObject({
      failure: { kind: "unauthorised" },
    });
    await expect(failure).rejects.not.toSatisfy(
      (error: unknown) =>
        error instanceof Error && error.message.includes("secret-looking"),
    );
  });

  test("reports an empty gh token as unauthorised", async () => {
    const port = githubTokenFromEnvironment({
      env: {},
      runGh: async () => Promise.resolve("\n"),
    });
    await expect(port("ExaDev", undefined)).rejects.toMatchObject({
      failure: { kind: "unauthorised" },
    });
  });
});
