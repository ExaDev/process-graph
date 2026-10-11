import { describe, expect, it } from "vitest";
import { deriveStatuses } from "./derive.ts";
import {
  artefactKey,
  elementStatusKey,
  emptyFactRecord,
  factNamesIn,
  factsFrom,
  layeredFacts,
} from "./facts.ts";
import { readySet } from "./queries.ts";
import { fails, holds, noFacts } from "./test-support/conditions.ts";
import { approval, pipeline } from "./test-support/models.ts";

const yes = { kind: "boolean", value: true } as const;
const no = { kind: "boolean", value: false } as const;

describe("factsFrom", () => {
  it("answers a named fact with its recorded value, of any kind", () => {
    const facts = factsFrom({
      artefacts: {},
      values: { approved: yes, budget: { kind: "number", value: 3 } },
    });

    expect(facts("approved")).toEqual({ found: true, value: yes });
    expect(facts("budget")).toEqual({
      found: true,
      value: { kind: "number", value: 3 },
    });
  });

  it("answers an artefact key with the recorded provision, false included", () => {
    const facts = factsFrom({
      artefacts: { spec: true, bundle: false },
      values: {},
    });

    expect(facts(artefactKey("spec"))).toEqual({ found: true, value: yes });
    expect(facts(artefactKey("bundle"))).toEqual({ found: true, value: no });
  });

  it("does not find what the record does not hold", () => {
    const facts = factsFrom({
      artefacts: { spec: true },
      values: { approved: yes },
    });

    expect(facts("unrecorded")).toEqual({ found: false });
    expect(facts(artefactKey("release"))).toEqual({ found: false });
    expect(facts({ $artefact: "spec", extra: true })).toEqual({
      found: false,
    });
    expect(facts({ $artefact: 1 })).toEqual({ found: false });
    expect(facts(["approved"])).toEqual({ found: false });
    expect(facts(null)).toEqual({ found: false });
    expect(facts(elementStatusKey("spec"))).toEqual({ found: false });
  });

  it("reads a name and an artefact id as different keys", () => {
    const facts = factsFrom({ artefacts: { spec: true }, values: {} });

    expect(facts("spec")).toEqual({ found: false });
  });

  it("does not treat an inherited property as a recorded fact", () => {
    const facts = factsFrom(emptyFactRecord);

    expect(facts("toString")).toEqual({ found: false });
    expect(facts(artefactKey("constructor"))).toEqual({ found: false });
  });
});

describe("layeredFacts", () => {
  const stored = factsFrom({ artefacts: {}, values: { approved: no } });
  const host = factsFrom({
    artefacts: {},
    values: { approved: yes, region: { kind: "text", value: "eu" } },
  });

  it("takes the first port that finds the key", () => {
    expect(layeredFacts(stored, host)("approved")).toEqual({
      found: true,
      value: no,
    });
  });

  it("falls through to a later port for what an earlier one lacks", () => {
    expect(layeredFacts(stored, host)("region")).toEqual({
      found: true,
      value: { kind: "text", value: "eu" },
    });
  });

  it("finds nothing when no port does", () => {
    expect(layeredFacts(stored, host)("other")).toEqual({ found: false });
    expect(layeredFacts()("approved")).toEqual({ found: false });
  });
});

describe("a recorded fact drives the status derivation", () => {
  it("blocks a consumer of an unproduced input until the record provides it", () => {
    expect(deriveStatuses(pipeline, {}, noFacts).get("build")).toBe("blocked");
    expect(
      deriveStatuses(
        pipeline,
        {},
        factsFrom({ artefacts: { spec: false }, values: {} }),
      ).get("build"),
    ).toBe("blocked");
    expect(
      readySet(
        pipeline,
        {},
        factsFrom({ artefacts: { spec: true }, values: {} }),
      ),
    ).toEqual(["build"]);
  });

  it("takes the branch a recorded fact selects and skips the other", () => {
    const statuses = (approved: boolean) =>
      deriveStatuses(
        approval,
        { triage: "done" },
        factsFrom({
          artefacts: {},
          values: { approved: { kind: "boolean", value: approved } },
        }),
      );

    expect(statuses(true).get("accept")).toBe("ready");
    expect(statuses(true).get("reject")).toBe("skipped");
    expect(statuses(false).get("accept")).toBe("skipped");
    expect(statuses(false).get("reject")).toBe("ready");
  });

  it("leaves both branches unknown when the record does not hold the fact", () => {
    const statuses = deriveStatuses(
      approval,
      { triage: "done" },
      factsFrom(emptyFactRecord),
    );

    expect(statuses.get("accept")).toBe("unknown");
    expect(statuses.get("reject")).toBe("unknown");
  });
});

describe("factNamesIn", () => {
  it("lists each named fact a condition reads once, in the order met, and no reserved key", () => {
    expect(
      factNamesIn({
        kind: "and",
        operands: [
          holds("approved"),
          {
            kind: "or",
            operands: [
              fails("budgeted"),
              holds("approved"),
              {
                kind: "textCompare",
                op: "equals",
                left: { kind: "reference", key: elementStatusKey("audit") },
                right: { kind: "textLiteral", value: "done" },
              },
            ],
          },
          {
            kind: "compare",
            op: "gt",
            left: { kind: "reference", key: "budget" },
            right: { kind: "numberLiteral", value: 0 },
          },
        ],
      }),
    ).toEqual(["approved", "budgeted", "budget"]);
  });

  it("finds nothing in a condition that reads no named fact", () => {
    expect(factNamesIn({ kind: "booleanLiteral", value: true })).toEqual([]);
  });
});
