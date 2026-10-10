import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { exitCodes } from "./exit-codes.ts";
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

/** An order process built through `add`: a customer submits, the shop decides whether the order is in stock, then packs it or the customer is refunded. */
const orderSteps: readonly (readonly string[])[] = [
  ["add", "participant", "customer", "Customer"],
  ["add", "participant", "shop", "Shop", "--kind", "system"],
  ["add", "participant", "order", "Order", "--kind", "entity"],
  ["add", "participant", "courier", "Courier", "--kind", "system"],
  ["add", "activity", "submit", "Submit order", "--actor", "customer"],
  ["add", "decision", "stock", "In stock?", "--actor", "shop"],
  ["add", "activity", "pack", "Pack", "--actor", "shop"],
  ["add", "activity", "refund", "Refund", "--actor", "customer"],
  ["add", "transition", "submit", "stock", "--id", "t1"],
  ["add", "transition", "stock", "pack", "--id", "t2", "--guard", "yes"],
  ["add", "transition", "stock", "refund", "--id", "t3", "--guard", "no"],
];

describe("add", () => {
  test("creates the model and reports each record with the revision it took", async () => {
    const results = await runInOrder(harness, orderSteps.slice(0, 2));

    expect(results).toEqual([
      {
        code: exitCodes.success,
        stdout: "added participant customer at revision 1\n",
        stderr: "",
      },
      {
        code: exitCodes.success,
        stdout: "added participant shop at revision 2\n",
        stderr: "",
      },
    ]);
  });

  test("names a transition after its ends when no identifier is given", async () => {
    await runInOrder(
      harness,
      orderSteps.filter(([, kind]) => kind !== "transition"),
    );

    expect(
      JSON.parse(
        (await harness.run("add", "transition", "submit", "stock", "--json"))
          .stdout,
      ),
    ).toEqual({ added: "transition", id: "submit->stock", revision: 9 });
  });

  test("adds events, states and deliverable artefacts", async () => {
    const results = await runInOrder(harness, [
      ["add", "event", "paid", "Payment received"],
      ["add", "state", "waiting", "Waiting"],
      ["add", "artefact", "invoice", "Invoice", "--deliverable"],
      ["validate", "--json"],
    ]);

    expect(results.map((result) => result.code)).toEqual([
      exitCodes.success,
      exitCodes.success,
      exitCodes.success,
      exitCodes.success,
    ]);
    expect(results.at(-1)?.stdout).toBe(
      '{\n  "valid": true,\n  "issues": []\n}\n',
    );
  });

  test("rejects a record that would leave the model invalid, and changes nothing", async () => {
    await runInOrder(harness, orderSteps.slice(0, 1));
    const duplicate = await harness.run(
      "add",
      "participant",
      "customer",
      "Again",
    );
    const dangling = await harness.run(
      "add",
      "transition",
      "submit",
      "nowhere",
    );

    expect(duplicate.code).toBe(exitCodes.invalidModel);
    expect(duplicate.stderr).toContain("duplicate-id");
    expect(dangling.code).toBe(exitCodes.invalidModel);
    expect(dangling.stderr).toContain("unknown-reference");
    expect(
      JSON.parse((await harness.run("validate", "--json")).stdout),
    ).toEqual({
      valid: true,
      issues: [],
    });
  });

  test("rejects a participant kind outside its choices as a usage error", async () => {
    const result = await harness.run(
      "add",
      "participant",
      "x",
      "X",
      "--kind",
      "robot",
    );

    expect(result.code).toBe(exitCodes.usage);
    expect(result.stderr).toContain(
      "error: option '--kind <kind>' argument 'robot' is invalid. Allowed choices are role, system, entity.",
    );
  });
});

describe("show", () => {
  beforeEach(async () => {
    const results = await runInOrder(harness, orderSteps);
    expect(results.every((result) => result.code === exitCodes.success)).toBe(
      true,
    );
  });

  test("draws the flowchart in Mermaid by default", async () => {
    expect(await harness.run("show")).toEqual({
      code: exitCodes.success,
      stdout: [
        "flowchart TD",
        '  n0["Submit order"]',
        '  n1{"In stock?"}',
        '  n2["Pack"]',
        '  n3["Refund"]',
        "  n0 --> n1",
        '  n1 -->|"yes"| n2',
        '  n1 -->|"no"| n3',
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  test("draws the flowchart in DOT", async () => {
    expect(
      (await harness.run("show", "--view", "flowchart", "--format", "dot"))
        .stdout,
    ).toBe(
      [
        'digraph "flowchart" {',
        '  rankdir="TB";',
        '  "submit" [label="Submit order", shape="box"];',
        '  "stock" [label="In stock?", shape="diamond"];',
        '  "pack" [label="Pack", shape="box"];',
        '  "refund" [label="Refund", shape="box"];',
        '  "submit" -> "stock";',
        '  "stock" -> "pack" [label="yes"];',
        '  "stock" -> "refund" [label="no"];',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("draws the swimlane with a lane per actor, an empty lane kept and hand-offs thick", async () => {
    expect((await harness.run("show", "--view", "swimlane")).stdout).toBe(
      [
        "flowchart LR",
        '  subgraph lane0["Customer"]',
        '    n0["Submit order"]',
        '    n3["Refund"]',
        "  end",
        '  subgraph lane1["Shop"]',
        '    n1{"In stock?"}',
        '    n2["Pack"]',
        "  end",
        '  subgraph lane2["Courier"]',
        "  end",
        "  n0 ==> n1",
        '  n1 -->|"yes"| n2',
        '  n1 ==>|"no"| n3',
        "",
      ].join("\n"),
    );
    expect(
      (await harness.run("show", "--view", "swimlane", "--format", "dot"))
        .stdout,
    ).toBe(
      [
        'digraph "swimlane" {',
        '  rankdir="LR";',
        '  subgraph "cluster_lane0" {',
        '    label="Customer";',
        '    "submit" [label="Submit order", shape="box"];',
        '    "refund" [label="Refund", shape="box"];',
        "  }",
        '  subgraph "cluster_lane1" {',
        '    label="Shop";',
        '    "stock" [label="In stock?", shape="diamond"];',
        '    "pack" [label="Pack", shape="box"];',
        "  }",
        '  subgraph "cluster_lane2" {',
        '    label="Courier";',
        '    "cluster_lane2:empty" [shape="point", style="invis"];',
        "  }",
        '  "submit" -> "stock" [style="bold"];',
        '  "stock" -> "pack" [label="yes"];',
        '  "stock" -> "refund" [label="no", style="bold"];',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("draws the state machine of a subject, with decisions folded into guards", async () => {
    expect(
      (await harness.run("show", "--view", "state", "--subject", "order"))
        .stdout,
    ).toBe(
      [
        "stateDiagram-v2",
        '  state "Submit order" as s0',
        '  state "Pack" as s1',
        '  state "Refund" as s2',
        "  s0 --> s1 : [yes]",
        "  s0 --> s2 : [no]",
        "",
      ].join("\n"),
    );
    expect(
      (
        await harness.run(
          "show",
          "--view",
          "state",
          "--subject",
          "order",
          "--format",
          "dot",
        )
      ).stdout,
    ).toBe(
      [
        'digraph "state machine" {',
        '  rankdir="LR";',
        '  "submit" [label="Submit order", shape="box", style="rounded"];',
        '  "pack" [label="Pack", shape="box", style="rounded"];',
        '  "refund" [label="Refund", shape="box", style="rounded"];',
        '  "submit" -> "pack" [label="[yes]"];',
        '  "submit" -> "refund" [label="[no]"];',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("draws a sequence diagram along a scenario", async () => {
    expect(
      (
        await harness.run(
          "show",
          "--view",
          "sequence",
          "--scenario",
          "t1",
          "t3",
        )
      ).stdout,
    ).toBe(
      [
        "sequenceDiagram",
        "  participant p0 as Customer",
        "  participant p1 as Shop",
        "  p0->>p1: In stock?",
        "  p1->>p0: Refund",
        "",
      ].join("\n"),
    );
    expect(
      (
        await harness.run(
          "show",
          "--view",
          "sequence",
          "--scenario",
          "t1",
          "t3",
          "--format",
          "dot",
        )
      ).stdout,
    ).toBe(
      [
        'digraph "sequence" {',
        '  rankdir="TB";',
        '  "p0" [label="Customer", shape="box"];',
        '  "p1" [label="Shop", shape="box"];',
        '  { rank="same"; "p0"; "p1"; }',
        '  "p0" -> "p1" [style="invis"];',
        '  "p0.1" [shape="point", width="0"];',
        '  "p1.1" [shape="point", width="0"];',
        '  { rank="same"; "p0.1"; "p1.1"; }',
        '  "p0.2" [shape="point", width="0"];',
        '  "p1.2" [shape="point", width="0"];',
        '  { rank="same"; "p0.2"; "p1.2"; }',
        '  "p0" -> "p0.1" -> "p0.2" [style="dashed", arrowhead="none"];',
        '  "p1" -> "p1.1" -> "p1.2" [style="dashed", arrowhead="none"];',
        '  "p0.1" -> "p1.1" [label="1. In stock?", constraint="false"];',
        '  "p1.2" -> "p0.2" [label="2. Refund", constraint="false"];',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("writes the projection itself as JSON", async () => {
    const flowchart: unknown = JSON.parse(
      (await harness.run("show", "--format", "json")).stdout,
    );

    expect(flowchart).toMatchObject({
      nodes: [
        { id: "submit", label: "Submit order", shape: "process" },
        { id: "stock", label: "In stock?", shape: "decision" },
        { id: "pack", label: "Pack", shape: "process" },
        { id: "refund", label: "Refund", shape: "process" },
      ],
      edges: [
        { from: "submit", to: "stock" },
        { from: "stock", to: "pack", label: "yes" },
        { from: "stock", to: "refund", label: "no" },
      ],
    });
    expect(JSON.parse((await harness.run("show", "--json")).stdout)).toEqual({
      view: "flowchart",
      format: "mermaid",
      text: (await harness.run("show")).stdout,
    });
  });

  test("needs a subject for the state view and a scenario for the sequence view", async () => {
    expect(await harness.run("show", "--view", "state")).toEqual({
      code: exitCodes.usage,
      stdout: "",
      stderr:
        "the state view needs --subject <entity>: the model declares no state machine projection\n",
    });
    expect(
      await harness.run("show", "--view", "state", "--subject", "shop"),
    ).toEqual({
      code: exitCodes.usage,
      stdout: "",
      stderr: '"shop" is a system; a state machine follows an entity\n',
    });
    expect(
      (await harness.run("show", "--view", "state", "--subject", "nobody"))
        .code,
    ).toBe(exitCodes.notFound);
    expect((await harness.run("show", "--view", "sequence")).code).toBe(
      exitCodes.usage,
    );
    expect(
      await harness.run("show", "--view", "sequence", "--scenario", "t1", "t9"),
    ).toEqual({
      code: exitCodes.notFound,
      stdout: "",
      stderr: 'no transition "t9" in the model\n',
    });
  });

  test("rejects a view outside its choices as a usage error", async () => {
    expect((await harness.run("show", "--view", "gantt")).code).toBe(
      exitCodes.usage,
    );
  });
});

describe("cycles and validate", () => {
  beforeEach(async () => {
    await runInOrder(harness, [
      ["add", "activity", "a", "A"],
      ["add", "activity", "b", "B"],
      ["add", "transition", "a", "b"],
      ["add", "transition", "b", "a"],
    ]);
  });

  test("cycles lists a cycle no decision closes and exits with the invalid model status", async () => {
    expect(await harness.run("cycles")).toEqual({
      code: exitCodes.invalidModel,
      stdout: "a -> b -> a\n",
      stderr: "",
    });
  });

  test("validate reports the cycle as an issue", async () => {
    expect(await harness.run("validate")).toEqual({
      code: exitCodes.invalidModel,
      stdout: "illegal-cycle\tcycle with no decision in it: a -> b -> a\n",
      stderr: "",
    });
  });

  test("a reasoning command refuses a model with an illegal cycle", async () => {
    const result = await harness.run("ready");

    expect(result.code).toBe(exitCodes.invalidModel);
    expect(result.stderr).toBe(
      "The graph contains a cycle: a -> b -> a; run cycles to list them\n",
    );
  });
});

describe("validate <file>", () => {
  const write = (name: string, content: string): string => {
    const path = join(harness.directory, name);
    writeFileSync(path, content);

    return path;
  };

  test("finds nothing wrong with a valid model document", async () => {
    const path = write(
      "model.json",
      JSON.stringify({
        participants: [{ id: "team", label: "Team", kind: "role" }],
        events: [],
        actions: [],
        artefacts: [],
        elements: [{ kind: "activity", id: "a", label: "A", actor: "team" }],
        transitions: [],
        fragments: [],
        projections: [],
      }),
    );

    expect(await harness.run("validate", path)).toEqual({
      code: exitCodes.success,
      stdout: "valid\n",
      stderr: "",
    });
  });

  test("locates each shape problem by JSON pointer", async () => {
    const path = write(
      "broken.json",
      JSON.stringify({
        participants: [{ id: "team", label: "Team", kind: "robot" }],
        events: [],
        actions: [],
        artefacts: [],
        elements: [],
        transitions: [],
        fragments: [],
        projections: [],
      }),
    );
    const result = await harness.run("validate", path, "--json");

    expect(result.code).toBe(exitCodes.invalidModel);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: false,
      issues: [{ code: "schema", pointer: "/participants/0/kind" }],
    });
  });

  test("reports a reference to an undeclared element", async () => {
    const path = write(
      "dangling.json",
      JSON.stringify({
        participants: [],
        events: [],
        actions: [],
        artefacts: [],
        elements: [{ kind: "activity", id: "a", label: "A" }],
        transitions: [{ id: "t", source: "a", target: "z" }],
        fragments: [],
        projections: [],
      }),
    );

    expect(await harness.run("validate", path)).toEqual({
      code: exitCodes.invalidModel,
      stdout:
        'unknown-reference\ttransition "t" target refers to unknown id "z"\n',
      stderr: "",
    });
  });

  test("reports text that is not JSON at the document itself", async () => {
    const result = await harness.run(
      "validate",
      write("text.json", "not json"),
    );

    expect(result.code).toBe(exitCodes.invalidModel);
    expect(result.stdout).toMatch(/^schema\t\/\tnot JSON: /u);
  });
});

describe("the program", () => {
  test("prints help with the exit statuses, and exits successfully", async () => {
    const result = await harness.run("--help");

    expect(result.code).toBe(exitCodes.success);
    expect(result.stdout).toContain("Usage: process-graph [options] [command]");
    expect(result.stdout).toContain(
      "  4  the model has problems: validation issues, an illegal cycle, or a change the store rejected",
    );
    expect(result.stdout).not.toMatch(/ -- |—/u);
  });

  test("prints its version", async () => {
    expect(await harness.run("--version")).toEqual({
      code: exitCodes.success,
      stdout: "0.0.0-test\n",
      stderr: "",
    });
  });

  test("rejects an unknown command as a usage error", async () => {
    const result = await harness.run("frobnicate");

    expect(result.code).toBe(exitCodes.usage);
    expect(result.stderr).toContain("error: unknown command 'frobnicate'");
  });

  test("keeps models apart by --model and files apart by --data", async () => {
    await harness.run("add", "activity", "a", "A", "--model", "one");
    const other = join(harness.directory, "other.sqlite3");
    await harness.run("add", "activity", "b", "B", "--data", other);

    expect((await harness.run("ready", "--model", "one")).stdout).toBe(
      "a\tA\n",
    );
    expect((await harness.run("ready", "--data", other)).stdout).toBe("b\tB\n");
    expect((await harness.run("ready")).code).toBe(exitCodes.notFound);
  });
});
