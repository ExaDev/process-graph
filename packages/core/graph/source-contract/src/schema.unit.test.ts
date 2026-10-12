import type {
  Element,
  Extensions,
  OpenIds,
  Participant,
  Transition,
} from "@exadev/process-graph-schema";
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  boundActivitySchema,
  type BoundActivity,
  type SourceParticipant,
  type SourceTransition,
  syncInputSchema,
  syncPageSchema,
  type SyncPage,
} from "./schema.ts";

describe("boundActivitySchema", () => {
  test("is the model's activity variant", () => {
    expectTypeOf<BoundActivity["kind"]>().toEqualTypeOf<"activity">();
    expectTypeOf<BoundActivity>().toExtend<Element<string, OpenIds>>();
    expectTypeOf<SourceParticipant>().toEqualTypeOf<Participant<string>>();
    expectTypeOf<SourceTransition>().toExtend<Transition<string, OpenIds>>();
  });

  test("is exactly the model's activity with a required source", () => {
    expectTypeOf<SyncPage["activities"][number]>().toEqualTypeOf<{
      readonly kind: "activity";
      readonly id: string;
      readonly extensions?: Extensions;
      readonly label: string;
      readonly actor?: string;
      readonly action?: string;
      readonly source: string;
      readonly affects?: readonly string[];
      readonly consumes?: readonly string[];
      readonly produces?: readonly string[];
    }>();
  });

  test("requires the source and its equality with the identifier", () => {
    const bound = {
      kind: "activity",
      id: "github:o/r#1",
      source: "github:o/r#1",
      label: "x",
    };
    expect(boundActivitySchema.parse(bound)).toEqual(bound);
    expect(
      boundActivitySchema.safeParse({ ...bound, source: "github:o/r#2" })
        .success,
    ).toBe(false);
    expect(
      boundActivitySchema.safeParse({
        kind: "activity",
        id: "github:o/r#1",
        label: "x",
      }).success,
    ).toBe(false);
  });

  test("rejects a field the model does not define", () => {
    expect(
      boundActivitySchema.safeParse({
        kind: "activity",
        id: "a:1",
        source: "a:1",
        label: "x",
        url: "u",
      }).success,
    ).toBe(false);
  });
});

describe("syncInputSchema", () => {
  test("needs at least one scope identifier", () => {
    expect(syncInputSchema.safeParse({ scope: [] }).success).toBe(false);
    expect(syncInputSchema.safeParse({ scope: ["a:b"] }).success).toBe(true);
  });
});

describe("syncPageSchema", () => {
  test("accepts an overlay of model statuses only", () => {
    const page = {
      participants: [],
      activities: [],
      transitions: [],
      relations: [],
      gaps: [],
    };
    expect(
      syncPageSchema.safeParse({ ...page, overlay: { "a:1": "done" } }).success,
    ).toBe(true);
    expect(
      syncPageSchema.safeParse({ ...page, overlay: { "a:1": "closed" } })
        .success,
    ).toBe(false);
  });
});
