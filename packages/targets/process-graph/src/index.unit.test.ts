import * as dagPackage from "@exadev/process-graph-dag";
import * as domainPackage from "@exadev/process-graph-domain";
import * as exportPackage from "@exadev/process-graph-export";
import * as projectionPackage from "@exadev/process-graph-projection";
import * as schemaPackage from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import * as entrypoint from "./index.ts";

const flatLayers = [
  ["schema", schemaPackage],
  ["projection", projectionPackage],
  ["export", exportPackage],
  ["domain", domainPackage],
] as const;

describe("the primary entry point's runtime export surface", () => {
  test("no name is exported by more than one flat layer", () => {
    const owners = new Map<string, string[]>();
    for (const [layer, exports] of flatLayers) {
      for (const name of Object.keys(exports)) {
        owners.set(name, [...(owners.get(name) ?? []), layer]);
      }
    }
    const duplicates = [...owners]
      .filter(([, layers]) => layers.length > 1)
      .map(([name, layers]) => `${name}: ${layers.join(", ")}`);

    expect(duplicates).toEqual([]);
  });

  test.each(flatLayers)(
    "every runtime export of the %s package is exported flat and is the same value",
    (_layer, exports) => {
      for (const [name, value] of Object.entries(exports)) {
        expect(entrypoint).toHaveProperty([name], value);
      }
    },
  );

  test("the DAG package is the `dag` namespace, with every export present", () => {
    for (const [name, value] of Object.entries(dagPackage)) {
      expect(entrypoint.dag).toHaveProperty([name], value);
    }
    expect(Object.keys(entrypoint.dag).sort()).toEqual(
      Object.keys(dagPackage).sort(),
    );
  });

  test("the DAG layer's names are reachable only through the namespace", () => {
    for (const name of Object.keys(dagPackage)) {
      const flat = Object.getOwnPropertyDescriptor(entrypoint, name);
      const fromFlatLayer = flatLayers.some(([, exports]) => name in exports);

      expect(flat !== undefined).toBe(fromFlatLayer);
    }
  });

  test("the entry point exports the flat layers and `dag`, and nothing else", () => {
    const expected = [
      ...flatLayers.flatMap(([, exports]) => Object.keys(exports)),
      "dag",
    ];

    expect(Object.keys(entrypoint).sort()).toEqual(expected.sort());
  });

  test("the colliding names stay distinct functions", () => {
    expect(entrypoint.criticalPath).toBe(domainPackage.criticalPath);
    expect(entrypoint.dag.criticalPath).toBe(dagPackage.criticalPath);
    expect(entrypoint.criticalPath).not.toBe(entrypoint.dag.criticalPath);
  });
});
