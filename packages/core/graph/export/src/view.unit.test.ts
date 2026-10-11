import {
  project,
  toFlowchart,
  toSequence,
  toStateMachine,
  toSwimlane,
} from "@exadev/process-graph-projection";
import type { Model, OpenIds } from "@exadev/process-graph-schema";
import { describe, expect, test } from "vitest";
import {
  flowchartToDot,
  sequenceToDot,
  stateMachineToDot,
  swimlaneToDot,
} from "./dot.ts";
import {
  flowchartToMermaid,
  sequenceToMermaid,
  stateMachineToMermaid,
  swimlaneToMermaid,
} from "./mermaid.ts";
import { viewText } from "./view.ts";

/** An order taken by a shop, followed through its states, with a payment provider the model names as an actor without declaring it, as a model loaded from a store can. */
const model: Model<OpenIds> = {
  participants: [
    { id: "customer", label: "Customer", kind: "role" },
    { id: "shop", label: "Shop", kind: "system" },
    { id: "order", label: "Order", kind: "entity" },
  ],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "submit", label: "Submit", actor: "customer" },
    { kind: "activity", id: "pack", label: "Pack", actor: "shop" },
    { kind: "activity", id: "pay", label: "Pay", actor: "provider" },
    { kind: "state", id: "placed", label: "Placed" },
    { kind: "state", id: "packed", label: "Packed" },
  ],
  transitions: [
    { id: "t1", source: "submit", target: "pack" },
    { id: "t2", source: "pack", target: "pay" },
    { id: "s1", source: "placed", target: "packed" },
  ],
  fragments: [],
  projections: [],
};

describe("viewText", () => {
  test("writes each notation in Mermaid and DOT with that notation's emitter", () => {
    const flowchart = toFlowchart(model);
    const swimlane = toSwimlane(model);
    const states = toStateMachine(model, "order");

    expect(
      viewText(model, { notation: "flowchart", view: flowchart }, "mermaid"),
    ).toBe(flowchartToMermaid(flowchart));
    expect(
      viewText(model, { notation: "flowchart", view: flowchart }, "dot"),
    ).toBe(flowchartToDot(flowchart));
    expect(
      viewText(model, { notation: "swimlane", view: swimlane }, "mermaid"),
    ).toBe(swimlaneToMermaid(swimlane));
    expect(
      viewText(model, { notation: "swimlane", view: swimlane }, "dot"),
    ).toBe(swimlaneToDot(swimlane));
    expect(
      viewText(model, { notation: "stateMachine", view: states }, "mermaid"),
    ).toBe(stateMachineToMermaid(states));
    expect(
      viewText(model, { notation: "stateMachine", view: states }, "dot"),
    ).toBe(stateMachineToDot(states));
  });

  test("labels a sequence's lifelines with their participants' labels, and an undeclared actor by its identifier", () => {
    const sequence = toSequence(model, ["t1", "t2"]);
    const labels: Readonly<Record<string, string>> = {
      customer: "Customer",
      shop: "Shop",
      provider: "provider",
    };
    const label = (id: string): string => labels[id] ?? "unexpected";

    expect(
      viewText(model, { notation: "sequence", view: sequence }, "mermaid"),
    ).toBe(sequenceToMermaid(sequence, label));
    expect(
      viewText(model, { notation: "sequence", view: sequence }, "dot"),
    ).toBe(sequenceToDot(sequence, label));
    expect(
      viewText(model, { notation: "sequence", view: sequence }, "mermaid"),
    ).toContain("participant p2 as provider");
  });

  test("writes the projection itself as JSON, indented and ending in a line break", () => {
    const projected = project(model, { id: "lanes", notation: "swimlane" });
    const text = viewText(model, projected, "json");

    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "lanes": [');
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toEqual(toSwimlane(model));
  });
});
