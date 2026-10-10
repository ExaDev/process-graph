import { describe, expect, it } from "vitest";
import { CycleError, UnknownNodeError } from "./errors.ts";

describe("CycleError", () => {
  it("carries the cycles and names them in its message", () => {
    const error = new CycleError([
      ["a", "b", "a"],
      ["c", "c"],
    ]);

    expect(error.name).toBe("CycleError");
    expect(error.cycles).toEqual([
      ["a", "b", "a"],
      ["c", "c"],
    ]);
    expect(error.message).toBe(
      "The graph contains a cycle: a -> b -> a; c -> c",
    );
  });
});

describe("UnknownNodeError", () => {
  it("carries the id and names it in its message", () => {
    const error = new UnknownNodeError("ghost");

    expect(error.name).toBe("UnknownNodeError");
    expect(error.id).toBe("ghost");
    expect(error.message).toBe('"ghost" is not a node of the graph');
  });
});
