import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  checkCatalog,
  checkPublishedManifest,
  checkWorkspace,
  readCatalog,
} from "./check-published-manifests.ts";

const catalog = new Map([
  ["zod", "4.6.5"],
  ["drizzle-orm", "1.0.0-rc.4"],
]);
const siblings = new Map([["@example/sibling", "1.2.3"]]);

/** A published package declaring the given dependencies, all in one field. */
const published = (
  field: "dependencies" | "devDependencies" | "peerDependencies",
  entries: Readonly<Record<string, string>>,
) => ({
  relativeDirectory: "packages/targets/example",
  dependencies: new Map([[field, new Map(Object.entries(entries))]]),
});

describe("checkPublishedManifest", () => {
  test("accepts exact versions equal to the catalog and to the siblings", () => {
    expect(
      checkPublishedManifest(
        published("dependencies", {
          zod: "4.6.5",
          "drizzle-orm": "1.0.0-rc.4",
          "@example/sibling": "1.2.3",
        }),
        catalog,
        siblings,
      ),
    ).toEqual([]);
  });

  test.each([
    "catalog:",
    "workspace:*",
    "workspace:^1.2.3",
    "link:../x",
    "file:../x",
  ])("rejects the protocol specifier %s in any shipped field", (specifier) => {
    expect(
      checkPublishedManifest(
        published("devDependencies", { zod: specifier }),
        catalog,
        siblings,
      ),
    ).toEqual([
      {
        where: "packages/targets/example/package.json",
        field: "devDependencies",
        name: "zod",
        specifier,
        reason:
          "npm publish ships a protocol specifier verbatim, which no consumer can install",
      },
    ]);
  });

  test.each(["dependencies", "devDependencies"] as const)(
    "rejects a range in %s",
    (field) => {
      expect(
        checkPublishedManifest(
          published(field, { zod: "^4.6.5" }),
          catalog,
          siblings,
        ).map((finding) => finding.reason),
      ).toEqual(["a published dependency must be an exact version"]);
    },
  );

  test("rejects a version that differs from the catalog's or the sibling's", () => {
    expect(
      checkPublishedManifest(
        published("dependencies", {
          zod: "4.6.4",
          "@example/sibling": "1.2.2",
        }),
        catalog,
        siblings,
      ).map((finding) => finding.reason),
    ).toEqual([
      "must equal the catalog entry, 4.6.5",
      "must equal the sibling's own version, 1.2.3",
    ]);
  });

  test("accepts an exact third-party version the catalog does not name", () => {
    expect(
      checkPublishedManifest(
        published("devDependencies", { tsdown: "0.23.0" }),
        catalog,
        siblings,
      ),
    ).toEqual([]);
  });
});

describe("checkPublishedManifest on peerDependencies", () => {
  const peerCatalog = new Map([
    ["react", "19.3.0"],
    ["@orpc/server", "2.0.0-beta.41"],
  ]);
  const peers = (entries: Readonly<Record<string, string>>) =>
    checkPublishedManifest(
      published("peerDependencies", entries),
      peerCatalog,
      siblings,
    ).map(({ name, reason }) => [name, reason]);

  test("accepts a caret range on a stable version the catalog satisfies, and an exact prerelease equal to the catalog", () => {
    expect(
      peers({ react: "^19.3.0", "@orpc/server": "2.0.0-beta.41" }),
    ).toEqual([]);
  });

  test("accepts a caret range whose floor is below the catalog's version, since the catalog still satisfies it", () => {
    expect(peers({ react: "^19.0.0" })).toEqual([]);
  });

  test("rejects a caret range the catalog's version does not satisfy", () => {
    expect(peers({ react: "^19.4.0" })).toEqual([
      [
        "react",
        "must be satisfied by the catalog entry, 19.3.0, which the tests run against",
      ],
    ]);
  });

  test.each(["19.3.0", "~19.3.0", ">=19.3.0", "19.x", "*"])(
    "rejects %s for a stable peer, which must be a caret range",
    (specifier) => {
      expect(peers({ react: specifier })).toEqual([
        [
          "react",
          "a stable peer must be a caret range on the lowest tested version, such as ^1.2.3",
        ],
      ]);
    },
  );

  test("rejects a range on a prerelease peer, which must stay exact", () => {
    expect(peers({ "@orpc/server": "^2.0.0-beta.41" })).toEqual([
      [
        "@orpc/server",
        "a prerelease peer must be an exact version, since a prerelease has no compatible-range semantics",
      ],
    ]);
  });

  test("rejects an exact prerelease peer that differs from the catalog's", () => {
    expect(peers({ "@orpc/server": "2.0.0-beta.40" })).toEqual([
      ["@orpc/server", "must equal the catalog entry, 2.0.0-beta.41"],
    ]);
  });

  test("checks a peer the catalog does not name by its own version", () => {
    expect(
      peers({ elkjs: "^0.12.0", vite: "8.3.2", next: "1.0.0-rc.1" }),
    ).toEqual([
      [
        "vite",
        "a stable peer must be a caret range on the lowest tested version, such as ^1.2.3",
      ],
    ]);
  });
});

describe("checkCatalog", () => {
  test("accepts exact versions, prereleases included, and rejects a range", () => {
    expect(
      checkCatalog(
        new Map([
          ["zod", "4.6.5"],
          ["drizzle-orm", "1.0.0-rc.4"],
          ["elkjs", "~0.12.0"],
        ]),
      ),
    ).toEqual([
      {
        where: "pnpm-workspace.yaml",
        name: "elkjs",
        specifier: "~0.12.0",
        reason: "a catalog entry must be an exact version",
      },
    ]);
  });
});

describe("readCatalog", () => {
  test("reads the default catalog's entries", () => {
    expect(
      readCatalog(
        'packages:\n  - "packages/*"\ncatalog:\n  "@scope/name": 1.0.0\n  zod: 4.6.5\n',
      ),
    ).toEqual(
      new Map([
        ["@scope/name", "1.0.0"],
        ["zod", "4.6.5"],
      ]),
    );
  });

  test("reads a document without a catalog as an empty one", () => {
    expect(readCatalog('packages:\n  - "packages/*"\n')).toEqual(new Map());
  });
});

test("this workspace's published manifests and catalog pass", async () => {
  await expect(
    checkWorkspace(join(import.meta.dirname, "..")),
  ).resolves.toEqual([]);
});
