import { describe, expect, it } from "vitest";
import {
  affectedMutationPackages,
  planShards,
  shardMatrix,
} from "./compute-mutation-shards.ts";

describe("affectedMutationPackages", () => {
  it("extracts only the _test:mutation task's own packages from a turbo dry-run plan", () => {
    const plan = JSON.stringify({
      tasks: [
        {
          task: "_build",
          package: "graph-dag",
          directory: "packages/core/graph/dag",
        },
        {
          task: "_test:mutation",
          package: "graph-dag",
          directory: "packages/core/graph/dag",
        },
        {
          task: "_test:mutation",
          package: "graph-schema",
          directory: "packages/core/graph/schema",
        },
      ],
    });
    expect(affectedMutationPackages(plan)).toEqual([
      { name: "graph-dag", directory: "packages/core/graph/dag" },
      {
        name: "graph-schema",
        directory: "packages/core/graph/schema",
      },
    ]);
  });

  it("returns an empty list when nothing is affected", () => {
    expect(affectedMutationPackages(JSON.stringify({ tasks: [] }))).toEqual([]);
  });
});

const maxShardsUnderTest = 3;

describe("planShards", () => {
  it("returns nothing for an empty weight map", () => {
    expect(planShards(new Map(), maxShardsUnderTest)).toEqual([]);
  });

  it("never creates more shards than packages, even when maxShards is larger", () => {
    const heavierWeight = 2;
    const lighterWeight = 1;
    const weights = new Map([
      ["a", heavierWeight],
      ["b", lighterWeight],
    ]);
    expect(planShards(weights, maxShardsUnderTest)).toHaveLength(2);
  });

  it("bounds shard count at maxShards regardless of how many packages there are", () => {
    const packageCountExceedingMaxShards = maxShardsUnderTest + 1;
    const equalWeight = 1;
    const weights = new Map(
      Array.from({ length: packageCountExceedingMaxShards }, (_, i) => [
        `pkg-${String(i)}`,
        equalWeight,
      ]),
    );
    expect(planShards(weights, maxShardsUnderTest)).toHaveLength(
      maxShardsUnderTest,
    );
  });

  it("strands the single largest package alone under round-robin but balances it here", () => {
    // The exact scenario the top-of-file note names: one package an order of magnitude larger than the rest. A naive `index % shardCount` assignment puts the giant on its own shard with 3 small packages on the other. This packs the giant alone precisely because doing so keeps both shards' totals as close as LPT bin-packing can get them.
    const giantWeight = 100;
    const smallWeight = 1;
    const shardCount = 2;
    const weights = new Map([
      ["giant", giantWeight],
      ["small-a", smallWeight],
      ["small-b", smallWeight],
      ["small-c", smallWeight],
    ]);
    const shards = planShards(weights, shardCount);
    expect(shards).toHaveLength(shardCount);
    const giantShard = shards.find((shard) => shard.includes("giant"));
    expect(giantShard).toEqual(["giant"]);
    const otherShard = shards.find((shard) => !shard.includes("giant"));
    expect(otherShard).toEqual(
      expect.arrayContaining(["small-a", "small-b", "small-c"]),
    );
  });

  it("balances near-equal weights roughly evenly across shards", () => {
    const equalWeight = 1;
    const shardCount = 2;
    const packagesPerShard = 2;
    const weights = new Map([
      ["a", equalWeight],
      ["b", equalWeight],
      ["c", equalWeight],
      ["d", equalWeight],
    ]);
    const shards = planShards(weights, shardCount);
    expect(shards).toHaveLength(shardCount);
    expect(shards[0]).toHaveLength(packagesPerShard);
    expect(shards[1]).toHaveLength(packagesPerShard);
  });

  it("assigns every package exactly once", () => {
    const packageNames = ["a", "b", "c", "d", "e"] as const;
    // Distinct, non-uniform weights (derived, not hand-picked) so the bin-packing genuinely has to distribute rather than trivially round-robin equal weights.
    const weights = new Map(
      packageNames.map((name, index) => [name, index + 1]),
    );
    const shards = planShards(weights, maxShardsUnderTest);
    const allAssigned = shards.flat();
    expect(allAssigned.sort()).toEqual([...packageNames].sort());
  });
});

describe("shardMatrix", () => {
  it("joins each shard's packages into a space-separated string, indexed from zero", () => {
    expect(shardMatrix([["a", "b"], ["c"]])).toEqual([
      { index: 0, packages: "a b" },
      { index: 1, packages: "c" },
    ]);
  });

  it("returns an empty array for no shards", () => {
    expect(shardMatrix([])).toEqual([]);
  });
});
