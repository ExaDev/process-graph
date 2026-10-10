import { describe, expect, it } from "vitest";
import { Occurrences } from "./occurrences.ts";

/** Enough repeats of one key that copying its group on every store would be far more work than storing each item once. */
const repeats = 5000;

describe("Occurrences", () => {
  const items = [
    ...Array.from({ length: repeats }, (_, index) => ({ key: "loop", index })),
    { key: "exit", index: repeats },
  ];

  it("stores each item once however often its key repeats", () => {
    let stored = 0;
    new Occurrences(
      items,
      (item) => item.key,
      () => {
        stored += 1;
      },
    );

    expect(stored).toBe(items.length);
  });

  it("reads each key's items back in order and reports the keys left unread", () => {
    const groups = new Occurrences(items, (item) => item.key);

    expect(groups.next("loop")).toEqual({ key: "loop", index: 0 });
    expect(groups.next("loop")).toEqual({ key: "loop", index: 1 });
    expect(groups.next("missing")).toBeUndefined();
    expect(groups.unread()).toEqual(["loop", "exit"]);
    expect(groups.next("exit")).toEqual({ key: "exit", index: repeats });
    expect(groups.next("exit")).toBeUndefined();
    expect(groups.unread()).toEqual(["loop"]);
  });
});
