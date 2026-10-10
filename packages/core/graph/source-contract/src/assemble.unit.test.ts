import { validate } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import { assembleSync } from "./assemble.ts";
import type { SyncPage } from "./schema.ts";
import { fakeOptions } from "./test-support/pages.ts";

const pagesOf = (scope: string): readonly SyncPage[] =>
  fakeOptions.scopes[scope] ?? [];

describe("assembleSync", () => {
  const assembled = assembleSync([
    ...pagesOf("fake:acme/alpha"),
    ...pagesOf("fake:acme/beta"),
  ]);

  test("keeps each element once, in first-seen order", () => {
    expect(assembled.model.elements.map((element) => element.id)).toEqual([
      "fake:acme/alpha#1",
      "fake:acme/alpha#2",
      "fake:acme/alpha#3",
      "fake:acme/beta#1",
    ]);
    expect(
      assembled.model.participants.map((participant) => participant.id),
    ).toEqual(["fake:acme", "fake:acme/alpha", "fake:@ada", "fake:acme/beta"]);
  });

  test("keeps every transition, including the one across repositories", () => {
    expect(
      assembled.model.transitions.map((transition) => transition.id),
    ).toEqual([
      "fake:acme/alpha#1->fake:acme/alpha#2",
      "fake:acme/alpha#2->fake:acme/beta#1",
    ]);
  });

  test("keeps each distinct relation once", () => {
    expect(assembled.relations).toEqual([
      { kind: "part-of", from: "fake:acme/alpha", to: "fake:acme" },
      { kind: "assigned-to", from: "fake:acme/alpha#1", to: "fake:@ada" },
      { kind: "child-of", from: "fake:acme/alpha#3", to: "fake:acme/alpha#2" },
      { kind: "part-of", from: "fake:acme/beta", to: "fake:acme" },
    ]);
  });

  test("merges the overlay, the later page winning", () => {
    const later = assembleSync([
      ...pagesOf("fake:acme/alpha"),
      {
        participants: [],
        activities: [],
        transitions: [],
        relations: [],
        overlay: { "fake:acme/alpha#2": "done" },
        gaps: [],
      },
    ]);
    expect(later.overlay).toEqual({
      "fake:acme/alpha#1": "done",
      "fake:acme/alpha#2": "done",
      "fake:acme/alpha#3": "open",
    });
  });

  test("produces a model the schema's validation accepts", () => {
    expect(validate(assembled.model)).toEqual([]);
  });

  test("keeps gaps in page order", () => {
    const gap = {
      target: "fake:acme/gamma",
      reason: "not-found",
      message: "missing",
    } as const;
    const withGap = assembleSync([
      {
        participants: [],
        activities: [],
        transitions: [],
        relations: [],
        overlay: {},
        gaps: [gap],
      },
      ...pagesOf("fake:acme/beta"),
    ]);
    expect(withGap.gaps).toEqual([gap]);
  });
});
