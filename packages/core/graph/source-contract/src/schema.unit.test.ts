import {
  boundActivitySchema,
  type Extensions,
  type OpenIds,
  type Participant,
  type Transition,
} from "@exadev/process-graph-schema";
import { describe, expect, expectTypeOf, test } from "vitest";
import {
  type SourceParticipant,
  type SourceTransition,
  syncInputSchema,
  syncPageSchema,
  type SyncPage,
} from "./schema.ts";

describe("a sync page's records", () => {
  test("are the model's own", () => {
    expectTypeOf<SourceParticipant>().toEqualTypeOf<Participant<string>>();
    expectTypeOf<SourceTransition>().toExtend<Transition<string, OpenIds>>();
  });

  test("hold activities exactly as the model's activity with a required source", () => {
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

  test("hold activities parsed by graph-schema's boundActivitySchema itself", () => {
    expect(syncPageSchema.unwrap().shape.activities.unwrap().element).toBe(
      boundActivitySchema,
    );
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
