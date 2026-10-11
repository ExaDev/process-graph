import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  commandLinePeers,
  installCommand,
  missingPeers,
  missingPeersMessage,
} from "./missing-peers.ts";

describe("missingPeers", () => {
  test("keeps the names that do not resolve, in the order given", () => {
    const installed = new Set(["commander"]);

    expect(
      missingPeers(["drizzle-orm", "commander", "@orpc/server"], (name) =>
        installed.has(name),
      ),
    ).toEqual(["drizzle-orm", "@orpc/server"]);
  });
});

describe("installCommand", () => {
  test.each([
    ["pnpm/12.4.1 npm/? node/v26.8.1 darwin arm64", "pnpm add a@1"],
    ["yarn/4.9.0 npm/? node/v26.8.1 linux x64", "yarn add a@1"],
    ["bun/1.3.0 npm/? node/v26.8.1 linux x64", "bun add a@1"],
    [
      "npm/11.19.1 node/v26.8.1 darwin arm64 workspaces/false",
      "npm install a@1",
    ],
    ["deno/2.5.0 npm/? deno/2.5.0 linux x64", "npm install a@1"],
    [undefined, "npm install a@1"],
  ])("from the user agent %s it is %s", (userAgent, expected) => {
    expect(installCommand(userAgent, ["a@1"])).toBe(expected);
  });
});

describe("missingPeersMessage", () => {
  const versions = new Map([
    ["commander", "15.0.0"],
    ["drizzle-orm", "1.0.0-rc.4"],
  ]);

  test("names the missing packages and the command that installs them at their declared versions", () => {
    expect(
      missingPeersMessage(
        ["commander", "drizzle-orm"],
        versions,
        "pnpm/12.4.1 npm/? node/v26.8.1 darwin arm64",
      ),
    ).toBe(
      [
        "process-graph: the command line needs these optional peer dependencies, which are not installed: commander, drizzle-orm.",
        "Install them beside process-graph: pnpm add commander@15.0.0 drizzle-orm@1.0.0-rc.4",
        "",
      ].join("\n"),
    );
  });

  test("refuses a package that is not a declared peer", () => {
    expect(() => missingPeersMessage(["elkjs"], versions, undefined)).toThrow(
      "process-graph declares no peer dependency on elkjs",
    );
  });
});

test("every peer the command line checks for is an optional peer dependency of the package", () => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const optional =
    typeof manifest === "object" &&
    manifest !== null &&
    "peerDependenciesMeta" in manifest &&
    typeof manifest.peerDependenciesMeta === "object" &&
    manifest.peerDependenciesMeta !== null
      ? Object.keys(manifest.peerDependenciesMeta)
      : [];

  expect(optional).toEqual(expect.arrayContaining([...commandLinePeers]));
});
