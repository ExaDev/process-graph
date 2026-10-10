import { describe, expect, test } from "vitest";
import { paginate } from "./paginate.ts";

interface Page {
  readonly value: string;
  readonly next?: string;
}

const pages: Readonly<Record<string, Page>> = {
  start: { value: "a", next: "b" },
  b: { value: "b", next: "c" },
  c: { value: "c" },
};

/** A reader over `pages` that records the key of every page it reads. */
const recordingReader = () => {
  const reads: string[] = [];
  const read = async (after: string | undefined): Promise<Page> => {
    const key = after ?? "start";
    reads.push(key);
    const page = pages[key];
    if (page === undefined) {
      throw new Error(`no page after ${key}`);
    }

    return Promise.resolve(page);
  };

  return { reads, read };
};

const valuesOf = async (
  iterable: Readonly<AsyncIterable<Page>>,
): Promise<string[]> => {
  const values: string[] = [];
  for await (const page of iterable) {
    values.push(page.value);
  }

  return values;
};

describe("paginate", () => {
  test("reads from the first cursor to the page without next", async () => {
    const { reads, read } = recordingReader();
    await expect(valuesOf(paginate(undefined, read))).resolves.toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(reads).toEqual(["start", "b", "c"]);
  });

  test("starts after the given cursor", async () => {
    const { read } = recordingReader();
    await expect(valuesOf(paginate("b", read))).resolves.toEqual(["b", "c"]);
  });

  test("reads nothing ahead of the consumer", async () => {
    const { reads, read } = recordingReader();
    const iterator = paginate(undefined, read)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: pages.start,
    });
    expect(reads).toEqual(["start"]);
  });
});
