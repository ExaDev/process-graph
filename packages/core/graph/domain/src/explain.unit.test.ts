import { UnknownNodeError } from "@exadev/process-graph-dag";
import type { OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, it } from "vitest";
import { deriveStatuses } from "./derive.ts";
import { explainStatus } from "./explain.ts";
import { blockedBy } from "./queries.ts";
import { factsOf, noFacts } from "./test-support/conditions.ts";
import { approval, chain, diamond, pipeline } from "./test-support/models.ts";

describe("explainStatus", () => {
  it("names the overlay when it decided the status", () => {
    expect(explainStatus(chain, { b: "done" }, noFacts, "b")).toMatchObject({
      element: "b",
      status: "done",
      rule: "overlay-done",
      chain: [{ element: "b", status: "done", waitingOn: [] }],
    });
    expect(explainStatus(chain, { a: "unknown" }, noFacts, "a")).toMatchObject({
      status: "unknown",
      rule: "overlay-unknown",
    });
  });

  it("gives the whole chain of unfinished work behind a blocked element", () => {
    expect(explainStatus(chain, {}, noFacts, "c")).toEqual({
      element: "c",
      status: "blocked",
      rule: "waiting",
      transitions: [
        {
          transition: "bc",
          source: "b",
          branch: "taken",
          sourceStatus: "blocked",
          cut: false,
        },
      ],
      artefacts: [],
      chain: [
        { element: "c", status: "blocked", waitingOn: ["b"] },
        { element: "a", status: "ready", waitingOn: [] },
        { element: "b", status: "blocked", waitingOn: ["a"] },
      ],
    });
  });

  it("branches the chain at a join and agrees with blockedBy on its ends", () => {
    const explained = explainStatus(diamond, { a: "done" }, noFacts, "d");

    expect(explained.chain).toEqual([
      { element: "d", status: "blocked", waitingOn: ["b", "c"] },
      { element: "b", status: "ready", waitingOn: [] },
      { element: "c", status: "ready", waitingOn: [] },
    ]);
    expect(
      explained.chain
        .slice(1)
        .filter((link) => link.waitingOn.length === 0)
        .map((link) => link.element),
    ).toEqual(blockedBy(diamond, { a: "done" }, noFacts, "d"));
  });

  it("explains a ready element as having its needs met", () => {
    expect(explainStatus(chain, { a: "done" }, noFacts, "b")).toMatchObject({
      status: "ready",
      rule: "needs-met",
      transitions: [{ source: "a", sourceStatus: "done", cut: false }],
      chain: [{ element: "b", waitingOn: [] }],
    });
  });

  it("explains a skipped element by its cut transitions", () => {
    expect(
      explainStatus(
        approval,
        { triage: "done" },
        factsOf({ approved: false }),
        "accept",
      ),
    ).toMatchObject({
      status: "skipped",
      rule: "all-cut",
      transitions: [
        {
          transition: "t-accept",
          source: "choose",
          branch: "not-taken",
          sourceStatus: "done",
          cut: true,
        },
      ],
    });
  });

  it("explains an unknown element by its indeterminate condition", () => {
    expect(
      explainStatus(approval, { triage: "done" }, noFacts, "accept"),
    ).toMatchObject({
      status: "unknown",
      rule: "unknown-need",
      transitions: [{ transition: "t-accept", branch: "indeterminate" }],
    });
  });

  it("reports each consumed artefact with whether it is satisfied", () => {
    expect(explainStatus(pipeline, {}, noFacts, "build")).toMatchObject({
      status: "blocked",
      rule: "waiting",
      artefacts: [
        { artefact: "spec", provided: false, producers: [], satisfied: false },
      ],
    });
    expect(
      explainStatus(pipeline, {}, factsOf({}, ["spec"]), "build"),
    ).toMatchObject({
      status: "ready",
      rule: "needs-met",
      artefacts: [{ artefact: "spec", provided: true, satisfied: true }],
    });
  });

  it("agrees with deriveStatuses on every element", () => {
    const overlay = { triage: "done" } as const;
    const facts = factsOf({ approved: true });
    for (const [id, status] of deriveStatuses(approval, overlay, facts)) {
      expect(explainStatus(approval, overlay, facts, id).status).toBe(status);
    }
  });

  it("throws for an element the model does not declare", () => {
    expect(() => explainStatus<OpenIds>(chain, {}, noFacts, "z")).toThrow(
      UnknownNodeError,
    );
  });
});
