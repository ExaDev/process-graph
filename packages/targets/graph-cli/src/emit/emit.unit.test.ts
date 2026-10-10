import type {
  Flowchart,
  SequenceDiagram,
  StateMachine,
} from "@exadev/process-graph-projection";
import type { OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import { flowchartToDot, sequenceToDot, stateMachineToDot } from "./dot.ts";
import {
  flowchartToMermaid,
  sequenceToMermaid,
  stateMachineToMermaid,
} from "./mermaid.ts";
import { dotString, mermaidText } from "./text.ts";

const lines = (...rows: readonly string[]): string => `${rows.join("\n")}\n`;

describe("text", () => {
  test("writes every character Mermaid reads as syntax as its entity code, and a line break as a space", () => {
    expect(mermaidText('Fix "a|b" <now> & #3; then: go\nnext')).toBe(
      "Fix #quot;a#124;b#quot; #lt;now#gt; #amp; #35;3#59; then#58; go next",
    );
  });

  test("quotes a DOT string with backslashes, quotes and line breaks escaped", () => {
    expect(dotString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c\\nd"');
  });
});

/** A flowchart with every node shape and an issue-style identifier. */
const flowchart: Flowchart<OpenIds> = {
  nodes: [
    { id: "start", label: "Start", shape: "terminator" },
    { id: "github:acme/app#1", label: 'Fix "login"', shape: "process" },
    { id: "fork", label: "Fork", shape: "bar" },
    { id: "ok", label: "OK?", shape: "decision" },
  ],
  edges: [
    { from: "start", to: "github:acme/app#1" },
    { from: "github:acme/app#1", to: "fork" },
    { from: "fork", to: "ok", label: "a|b" },
  ],
  loss: [],
};

describe("flowchart", () => {
  test("Mermaid names nodes by position and draws each shape", () => {
    expect(flowchartToMermaid(flowchart)).toBe(
      lines(
        "flowchart TD",
        '  n0(["Start"])',
        '  n1["Fix #quot;login#quot;"]',
        '  n2@{ shape: fork, label: "Fork" }',
        '  n3{"OK?"}',
        "  n0 --> n1",
        "  n1 --> n2",
        '  n2 -->|"a#124;b"| n3',
      ),
    );
  });

  test("DOT names nodes by their model identifiers and draws each shape", () => {
    expect(flowchartToDot(flowchart)).toBe(
      lines(
        'digraph "flowchart" {',
        '  rankdir="TB";',
        '  "start" [label="Start", shape="oval"];',
        '  "github:acme/app#1" [label="Fix \\"login\\"", shape="box"];',
        '  "fork" [label="Fork", shape="box", style="filled", fillcolor="black", fontcolor="white"];',
        '  "ok" [label="OK?", shape="diamond"];',
        '  "start" -> "github:acme/app#1";',
        '  "github:acme/app#1" -> "fork";',
        '  "fork" -> "ok" [label="a|b"];',
        "}",
      ),
    );
  });
});

const stateMachine: StateMachine<OpenIds> = {
  subject: "order",
  states: [
    { id: "begin", label: "Start", role: "initial" },
    { id: "placed", label: "Placed", role: "state" },
    { id: "paid", label: "Paid", role: "state" },
    { id: "end", label: "End", role: "final" },
  ],
  transitions: [
    { source: "begin", target: "placed" },
    {
      source: "placed",
      target: "paid",
      event: "pay",
      guard: "card ok",
      effect: "receipt",
    },
    { source: "paid", target: "end", effect: "archive" },
  ],
  loss: [],
};

describe("state machine", () => {
  test("Mermaid draws initial and final pseudo-states as [*] and labels transitions with event, guard and effect", () => {
    expect(stateMachineToMermaid(stateMachine)).toBe(
      lines(
        "stateDiagram-v2",
        '  state "Placed" as s0',
        '  state "Paid" as s1',
        "  [*] --> s0",
        "  s0 --> s1 : pay [card ok] / receipt",
        "  s1 --> [*] : / archive",
      ),
    );
  });

  test("DOT draws an initial point, a final double circle and rounded states", () => {
    expect(stateMachineToDot(stateMachine)).toBe(
      lines(
        'digraph "state machine" {',
        '  rankdir="LR";',
        '  "begin" [label="", shape="point"];',
        '  "placed" [label="Placed", shape="box", style="rounded"];',
        '  "paid" [label="Paid", shape="box", style="rounded"];',
        '  "end" [label="", shape="doublecircle"];',
        '  "begin" -> "placed";',
        '  "placed" -> "paid" [label="pay [card ok] / receipt"];',
        '  "paid" -> "end" [label="/ archive"];',
        "}",
      ),
    );
  });
});

const message = (transition: string, from: string, to: string, label: string) =>
  ({ transition, from, to, label }) as const;

/** A review loop holding an alternative: approved and published, or rejected; then a parallel notification. */
const sequence: SequenceDiagram<OpenIds> = {
  lifelines: ["author", "reviewer", "bot"],
  messages: [
    message("t1", "author", "reviewer", "Submit"),
    message("t2", "reviewer", "author", "Approve"),
    message("t3", "author", "bot", "Notify"),
  ],
  items: [
    {
      kind: "fragment",
      fragment: "review",
      operator: "loop",
      operands: [
        {
          guard: "until approved",
          items: [
            {
              kind: "message",
              message: message("t1", "author", "reviewer", "Submit"),
            },
            {
              kind: "fragment",
              fragment: "verdict",
              operator: "alt",
              operands: [
                {
                  guard: "approved",
                  items: [
                    {
                      kind: "message",
                      message: message("t2", "reviewer", "author", "Approve"),
                    },
                  ],
                },
                { items: [] },
              ],
            },
          ],
        },
      ],
    },
    {
      kind: "fragment",
      fragment: "tell",
      operator: "par",
      operands: [
        {
          items: [
            {
              kind: "message",
              message: message("t3", "author", "bot", "Notify"),
            },
          ],
        },
        { guard: "later", items: [] },
      ],
    },
  ],
  loss: [],
};

const labels: Readonly<Record<string, string>> = {
  author: "Author",
  reviewer: "Reviewer: lead",
  bot: "Bot",
};
const labelOf = (id: string): string => labels[id] ?? id;

describe("sequence diagram", () => {
  test("Mermaid nests fragments, separating alt operands with else and par operands with and", () => {
    expect(sequenceToMermaid(sequence, labelOf)).toBe(
      lines(
        "sequenceDiagram",
        "  participant p0 as Author",
        "  participant p1 as Reviewer#58; lead",
        "  participant p2 as Bot",
        "  loop until approved",
        "    p0->>p1: Submit",
        "    alt approved",
        "      p1->>p0: Approve",
        "    else",
        "    end",
        "  end",
        "  par",
        "    p0->>p2: Notify",
        "  and later",
        "  end",
      ),
    );
  });

  test("DOT draws a lifeline grid and prefixes each message with the fragments around it", () => {
    expect(sequenceToDot(sequence, labelOf)).toBe(
      lines(
        'digraph "sequence" {',
        '  rankdir="TB";',
        '  "p0" [label="Author", shape="box"];',
        '  "p1" [label="Reviewer: lead", shape="box"];',
        '  "p2" [label="Bot", shape="box"];',
        '  { rank="same"; "p0"; "p1"; "p2"; }',
        '  "p0" -> "p1" [style="invis"];',
        '  "p1" -> "p2" [style="invis"];',
        '  "p0.1" [shape="point", width="0"];',
        '  "p1.1" [shape="point", width="0"];',
        '  "p2.1" [shape="point", width="0"];',
        '  { rank="same"; "p0.1"; "p1.1"; "p2.1"; }',
        '  "p0.2" [shape="point", width="0"];',
        '  "p1.2" [shape="point", width="0"];',
        '  "p2.2" [shape="point", width="0"];',
        '  { rank="same"; "p0.2"; "p1.2"; "p2.2"; }',
        '  "p0.3" [shape="point", width="0"];',
        '  "p1.3" [shape="point", width="0"];',
        '  "p2.3" [shape="point", width="0"];',
        '  { rank="same"; "p0.3"; "p1.3"; "p2.3"; }',
        '  "p0" -> "p0.1" -> "p0.2" -> "p0.3" [style="dashed", arrowhead="none"];',
        '  "p1" -> "p1.1" -> "p1.2" -> "p1.3" [style="dashed", arrowhead="none"];',
        '  "p2" -> "p2.1" -> "p2.2" -> "p2.3" [style="dashed", arrowhead="none"];',
        '  "p0.1" -> "p1.1" [label="1. loop [until approved]: Submit", constraint="false"];',
        '  "p1.2" -> "p0.2" [label="2. loop [until approved] / alt [approved]: Approve", constraint="false"];',
        '  "p0.3" -> "p2.3" [label="3. par: Notify", constraint="false"];',
        "}",
      ),
    );
  });

  test("an empty scenario draws the lifelines alone", () => {
    expect(
      sequenceToDot(
        { lifelines: ["author"], messages: [], items: [], loss: [] },
        labelOf,
      ),
    ).toBe(
      lines(
        'digraph "sequence" {',
        '  rankdir="TB";',
        '  "p0" [label="Author", shape="box"];',
        '  { rank="same"; "p0"; }',
        "}",
      ),
    );
  });
});
