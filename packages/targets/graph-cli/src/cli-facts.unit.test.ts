import { openNodeGraphStore } from "@exadev/process-graph-sqlite-node";
import type { Model, OpenIds } from "@exadev/process-graph-schema";
import {
  createFakeGraphStore,
  createGraphStoreRouter,
} from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { exitCodes } from "./exit-codes.ts";
import { impactOf, ready, why } from "./queries.ts";
import type { GraphSession } from "./session.ts";
import {
  createHarness,
  runInOrder,
  type Harness,
} from "./test-support/harness.ts";

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

afterEach(() => {
  harness.remove();
});

/** A release built on the command line: `build` consumes the input `spec`, which no activity produces, and produces `bundle`, which `ship` consumes. */
const releaseSteps: readonly (readonly string[])[] = [
  ["add", "participant", "team", "Team"],
  ["add", "artefact", "spec", "Specification"],
  ["add", "artefact", "bundle", "Bundle", "--deliverable"],
  [
    "add",
    "activity",
    "build",
    "Build",
    "--actor",
    "team",
    "--consumes",
    "spec",
    "--produces",
    "bundle",
  ],
  [
    "add",
    "activity",
    "ship",
    "Ship",
    "--actor",
    "team",
    "--consumes",
    "bundle",
  ],
];

/** The condition that holds when the boolean fact `approved` is true. */
const approved = {
  kind: "compare",
  op: "eq",
  left: { kind: "reference", key: "approved" },
  right: { kind: "booleanLiteral", value: true },
} as const;

/** `triage` leads to the decision `choose`, which takes `accept` when `approved` holds and `reject` when it does not; both lead to `close`. */
const approvalModel: Model<OpenIds> = {
  participants: [{ id: "team", label: "Team", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "triage", label: "Triage", actor: "team" },
    { kind: "decision", id: "choose", label: "Approved?", actor: "team" },
    { kind: "activity", id: "accept", label: "Accept", actor: "team" },
    { kind: "activity", id: "reject", label: "Reject", actor: "team" },
    { kind: "activity", id: "close", label: "Close", actor: "team" },
  ],
  transitions: [
    { id: "t-choose", source: "triage", target: "choose" },
    {
      id: "t-accept",
      source: "choose",
      target: "accept",
      condition: approved,
    },
    {
      id: "t-reject",
      source: "choose",
      target: "reject",
      condition: { kind: "not", operand: approved },
    },
    { id: "t-close-a", source: "accept", target: "close" },
    { id: "t-close-r", source: "reject", target: "close" },
  ],
  fragments: [],
  projections: [],
};

/** Saves a model into the harness's data file directly, since the command line has no way to author a condition. */
const saveDirectly = async (model: Model<OpenIds>): Promise<void> => {
  const { store, close } = openNodeGraphStore(harness.dataPath);
  try {
    await createRouterClient(createGraphStoreRouter(store)).v1.models.save({
      modelId: "default",
      model,
    });
  } finally {
    close();
  }
};

describe("set artefact", () => {
  test("a consumer of an input no activity produces is blocked until the artefact is set provided, and ready after", async () => {
    await runInOrder(harness, releaseSteps);

    expect((await harness.run("ready")).stdout).toBe("");
    expect((await harness.run("why", "build")).stdout).toBe(
      "build is blocked: it waits on work that is not done\n" +
        "artefacts:\n" +
        "  spec: not provided, produced by nothing\n",
    );

    expect(await harness.run("set", "artefact", "spec", "provided")).toEqual({
      code: exitCodes.success,
      stdout: "set artefact spec to provided at revision 6\n",
      stderr: "",
    });

    expect((await harness.run("ready")).stdout).toBe("build\tBuild\n");
    expect((await harness.run("why", "build")).stdout).toBe(
      "build is ready: everything it needs is done\n" +
        "artefacts:\n" +
        "  spec: provided, produced by nothing\n",
    );
    expect((await harness.run("path")).stdout).toBe(
      "build\tBuild\nship\tShip\n",
    );
  });

  test("absent and unknown both leave the consumer blocked, and unknown forgets what was recorded", async () => {
    await runInOrder(harness, [
      ...releaseSteps,
      ["set", "artefact", "spec", "provided"],
    ]);

    expect(
      (await harness.run("set", "artefact", "spec", "absent")).stdout,
    ).toBe("set artefact spec to absent at revision 7\n");
    expect((await harness.run("ready")).stdout).toBe("");
    expect((await harness.run("facts")).stdout).toBe(
      "artefact\tspec\tabsent\n",
    );

    expect(
      (await harness.run("set", "artefact", "spec", "unknown")).stdout,
    ).toBe("set artefact spec to unknown at revision 8\n");
    expect((await harness.run("ready")).stdout).toBe("");
    expect((await harness.run("facts")).stdout).toBe("");
  });

  test("an artefact provided from outside satisfies its consumer although an activity also produces it", async () => {
    await runInOrder(harness, [
      ...releaseSteps,
      ["set", "artefact", "spec", "provided"],
      ["set", "artefact", "bundle", "provided"],
    ]);

    expect((await harness.run("ready")).stdout).toBe(
      "build\tBuild\nship\tShip\n",
    );
  });

  test("writes JSON with --json", async () => {
    await runInOrder(harness, releaseSteps);

    expect(
      JSON.parse(
        (await harness.run("set", "artefact", "spec", "provided", "--json"))
          .stdout,
      ),
    ).toEqual({ artefact: "spec", state: "provided", revision: 6 });
  });

  test("an artefact the model lacks is not found, and a state outside the choices is a usage error", async () => {
    await runInOrder(harness, releaseSteps);

    expect(await harness.run("set", "artefact", "invoice", "provided")).toEqual(
      {
        code: exitCodes.notFound,
        stdout: "",
        stderr: 'no artefact "invoice" in the model\n',
      },
    );
    expect((await harness.run("set", "artefact", "spec", "maybe")).code).toBe(
      exitCodes.usage,
    );
    expect((await harness.run("facts")).stdout).toBe("");
  });

  test("an element's run state is still set by set <id> <state>", async () => {
    await runInOrder(harness, [
      ...releaseSteps,
      ["set", "artefact", "spec", "provided"],
    ]);

    expect((await harness.run("set", "build", "done")).stdout).toBe(
      "set build to done at revision 7\n",
    );
    expect((await harness.run("ready")).stdout).toBe("ship\tShip\n");
  });
});

describe("set fact", () => {
  test("a stored fact decides the branch, unknown leaves both branches unknown, and every reasoning command follows", async () => {
    await saveDirectly(approvalModel);
    await harness.run("set", "triage", "done");

    expect((await harness.run("ready")).stdout).toBe("");
    expect((await harness.run("why", "accept")).stdout).toBe(
      "accept is unknown: something it needs is unknown, or a condition on the way to it cannot be decided\n" +
        "needs:\n" +
        "  choose (done) through t-accept, condition indeterminate\n",
    );

    expect(await harness.run("set", "fact", "approved", "true")).toEqual({
      code: exitCodes.success,
      stdout: "set fact approved to true at revision 3\n",
      stderr: "",
    });
    expect((await harness.run("ready")).stdout).toBe("accept\tAccept\n");
    expect((await harness.run("impact", "accept")).stdout).toBe(
      "close\tClose\n",
    );
    expect((await harness.run("impact", "reject")).stdout).toBe("");
    expect((await harness.run("blocked", "close")).stdout).toBe(
      "accept\tAccept\n",
    );
    expect((await harness.run("why", "reject")).stdout).toBe(
      "reject is skipped: every transition into it is cut\n" +
        "needs:\n" +
        "  choose (done) through t-reject, condition not-taken, cut\n",
    );

    await harness.run("set", "fact", "approved", "false");

    expect((await harness.run("ready")).stdout).toBe("reject\tReject\n");
    expect((await harness.run("path")).stdout).toBe(
      "reject\tReject\nclose\tClose\n",
    );

    expect(
      (await harness.run("set", "fact", "approved", "unknown")).stdout,
    ).toBe("set fact approved to unknown at revision 5\n");
    expect((await harness.run("ready")).stdout).toBe("");
    expect((await harness.run("facts")).stdout).toBe("");
  });

  test("reads true and false as booleans, a number as a number, anything else as text, and --text as text", async () => {
    await saveDirectly(approvalModel);
    await runInOrder(harness, [
      ["set", "fact", "approved", "true"],
      ["set", "fact", "budget", "-2.5e3"],
      ["set", "fact", "region", "eu-west"],
      ["set", "fact", "label", "false", "--text"],
    ]);

    expect((await harness.run("facts")).stdout).toBe(
      "fact\tapproved\ttrue\n" +
        "fact\tbudget\t-2500\n" +
        "fact\tlabel\tfalse\n" +
        "fact\tregion\teu-west\n",
    );
    expect(JSON.parse((await harness.run("facts", "--json")).stdout)).toEqual({
      revision: 5,
      facts: {
        artefacts: {},
        values: {
          approved: { kind: "boolean", value: true },
          budget: { kind: "number", value: -2500 },
          region: { kind: "text", value: "eu-west" },
          label: { kind: "text", value: "false" },
        },
      },
    });
    expect(
      JSON.parse(
        (await harness.run("set", "fact", "count", "007", "--json")).stdout,
      ),
    ).toEqual({
      fact: "count",
      value: { kind: "text", value: "007" },
      revision: 6,
    });
  });

  test("a fact on a model the store does not have is not found", async () => {
    expect(await harness.run("set", "fact", "approved", "true")).toEqual({
      code: exitCodes.notFound,
      stdout: "",
      stderr: 'no model "default" in the store; sync or add something first\n',
    });
  });

  test("facts are kept per model", async () => {
    await saveDirectly(approvalModel);
    await harness.run("set", "fact", "approved", "true");
    await harness.run("add", "participant", "team", "Team", "--model", "other");

    expect((await harness.run("facts", "--model", "other")).stdout).toBe("");
    expect((await harness.run("facts")).stdout).toBe("fact\tapproved\ttrue\n");
  });
});

describe("stored facts and a host's facts", () => {
  const sessionWith = async (hostApproves: boolean): Promise<GraphSession> => {
    const store = createRouterClient(
      createGraphStoreRouter(createFakeGraphStore()),
    );
    await store.v1.models.save({ modelId: "m", model: approvalModel });
    await store.v1.overlay.set({ modelId: "m", overlay: { triage: "done" } });

    return {
      store,
      modelId: "m",
      facts: (key) =>
        key === "approved"
          ? { found: true, value: { kind: "boolean", value: hostApproves } }
          : { found: false },
      signal: undefined,
    };
  };

  test("the host answers what the store does not record", async () => {
    const session = await sessionWith(true);

    await expect(ready(session)).resolves.toEqual({
      elements: [{ id: "accept", label: "Accept" }],
    });
  });

  test("the stored record overrides the host where it says something", async () => {
    const session = await sessionWith(true);
    await session.store.v1.facts.set({
      modelId: "m",
      facts: { values: { approved: { kind: "boolean", value: false } } },
    });

    await expect(ready(session)).resolves.toEqual({
      elements: [{ id: "reject", label: "Reject" }],
    });
    await expect(impactOf(session, "reject")).resolves.toMatchObject({
      impacted: [{ id: "close", label: "Close" }],
    });
    await expect(why(session, "accept")).resolves.toMatchObject({
      element: { id: "accept", status: "skipped" },
      rule: "all-cut",
    });
  });
});
