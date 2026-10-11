import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { version } from "./version.ts";

test("version is the manifest's version", () => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  expect(manifest).toHaveProperty("version", version);
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});
