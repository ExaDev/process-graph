import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  show,
  type FormatName,
  type ViewName,
} from "@exadev/process-graph-cli";
import { afterEach, describe, expect, test } from "vitest";
import { App } from "./app.tsx";
import { testPorts, type TestPorts } from "./test-support/ports.ts";
import { parseViewState } from "./url-state.ts";

afterEach(cleanup);

const acme = "?scope=github%3Aacme";
const modelId = "github:acme";

const addressOf = (ports: TestPorts) =>
  parseViewState(ports.address.observable.get()).state;

/** Renders the app on a store already synced from the fake `github:acme` scope. */
const synced = async (search = acme): Promise<TestPorts> => {
  const ports = testPorts({ token: "t", search });
  render(<App ports={ports.ports} />);
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  await waitFor(() => {
    expect(document.querySelector("[data-progress]")?.textContent).toContain(
      "Sync finished",
    );
  });

  return ports;
};

const cardOf = async (id: string): Promise<Element> =>
  waitFor(() => {
    const card = document.querySelector(
      `.react-flow__node [data-element-id="${id}"]`,
    );
    if (card === null) {
      throw new Error(`no card for ${id}`);
    }

    return card;
  });

const optionsOf = (list: string): readonly string[] =>
  within(screen.getByRole("listbox", { name: list }))
    .getAllByRole("option")
    .map((option) => option.textContent);

describe("the process view", () => {
  test("draws the swimlane by default and switches view from its tabs, writing the view to the address", async () => {
    const ports = await synced();
    await cardOf("github:acme/api#2");
    expect(document.querySelector('[data-view="swimlane"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Flowchart" }));

    expect(addressOf(ports).view).toBe("flowchart");
    expect(document.querySelector('[data-view="flowchart"]')).not.toBeNull();
    await cardOf("github:acme/api#2");
  });

  test("moves between view tabs with the arrow keys", async () => {
    const ports = await synced();
    const tabs = screen.getByRole("tablist", { name: "View" });

    fireEvent.keyDown(within(tabs).getByRole("tab", { name: "Swimlane" }), {
      key: "ArrowRight",
    });

    expect(addressOf(ports).view).toBe("state");
    expect(document.activeElement?.textContent).toBe("State machine");
  });

  test("says why a model of issues has no state machine", async () => {
    await synced(`${acme}&view=state`);

    expect(
      within(
        screen.getByRole("tabpanel", { name: /State machine of/u }),
      ).getByRole("status").textContent,
    ).toContain("this model declares no entity");
  });

  test("follows the critical path in the sequence view", async () => {
    await synced(`${acme}&view=sequence`);

    const figure = await screen.findByRole("figure");
    expect(
      [...figure.querySelectorAll("[data-lifeline]")].map(
        (line) => line.textContent,
      ),
    ).toEqual(["acme/api", "acme/web"]);
  });
});

describe("downloads", () => {
  test.each<readonly [string, FormatName, ViewName, string]>([
    ["Swimlane", "mermaid", "swimlane", "process-graph-swimlane.mmd"],
    ["Swimlane", "dot", "swimlane", "process-graph-swimlane.dot"],
    ["Swimlane", "json", "swimlane", "process-graph-swimlane.json"],
    ["Flowchart", "mermaid", "flowchart", "process-graph-flowchart.mmd"],
    ["Flowchart", "dot", "flowchart", "process-graph-flowchart.dot"],
  ])(
    "save the %s view as %s, exactly the text the command line's show writes for it",
    async (tab, format, view, name) => {
      const ports = await synced();
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      const label = { mermaid: "Mermaid", dot: "DOT", json: "JSON" }[format];

      fireEvent.click(
        screen.getByRole("button", {
          name: `Download the ${tab.toLowerCase()} as ${label}`,
        }),
      );

      const shown = await show(
        {
          store: ports.ports.store,
          modelId,
          facts: () => ({ found: false }),
          signal: undefined,
        },
        { view, format },
      );
      expect(ports.downloads).toEqual([
        {
          name,
          type: {
            mermaid: "text/plain",
            dot: "text/vnd.graphviz",
            json: "application/json",
          }[format],
          text: shown.text,
        },
      ]);
      expect(shown.text).toContain("Build the endpoint");
    },
  );

  test("follow the sequence the view draws", async () => {
    const ports = await synced(`${acme}&view=sequence`);
    await screen.findByRole("figure");
    fireEvent.click(
      screen.getByRole("button", { name: "Download the sequence as Mermaid" }),
    );

    const [file] = ports.downloads;
    expect(file?.text.startsWith("sequenceDiagram\n")).toBe(true);
    expect(file?.text).toContain("acme/web");
  });

  test("are not offered for a view the model cannot be drawn as", async () => {
    await synced(`${acme}&view=state`);

    expect(document.querySelector('[data-screen="export"]')).toBeNull();
  });
});

describe("the lists", () => {
  test("list the ready work and the blocked work with what it waits on", async () => {
    const ports = await synced();

    expect(optionsOf("Ready to start")).toEqual([
      "Build the endpoint Ready",
      "Publish the SDK Ready",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Blocked" }));
    expect(addressOf(ports).tab).toBe("blocked");
    expect(optionsOf("Blocked")).toEqual([
      "Build the page Blocked waits on Build the endpoint, Publish the SDK",
      "Ship the release Blocked waits on Build the endpoint, Publish the SDK",
    ]);
  });

  test("list the critical path and the hand-offs between repositories", async () => {
    await synced();

    fireEvent.click(screen.getByRole("tab", { name: "Critical path" }));
    expect(optionsOf("Critical path")).toEqual([
      "Build the endpoint Ready",
      "Build the page Blocked",
      "Ship the release Blocked",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Hand-offs" }));
    expect(
      within(screen.getByRole("list", { name: "Hand-offs" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "acme/api hands over to acme/web: Build the endpoint before Build the page",
      "partner/sdk hands over to acme/web: Publish the SDK before Build the page",
    ]);
  });

  test("share the selection with the address, the details and the keyboard", async () => {
    const ports = await synced();
    const ready = screen.getByRole("listbox", { name: "Ready to start" });

    fireEvent.keyDown(ready, { key: "ArrowDown" });

    expect(addressOf(ports).selected).toBe("github:acme/api#2");
    const details = await screen.findByRole("complementary", {
      name: "Build the endpoint",
    });
    expect(details.textContent).toContain("Everything it needs is done.");
    expect(
      [...details.querySelectorAll('[data-section="impact"] li')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Build the page", "Ship the release"]);
  });

  test("follow the filter in the address", async () => {
    const ports = await synced(`${acme}&source=github%3Apartner%2Fsdk`);

    expect(optionsOf("Ready to start")).toEqual(["Publish the SDK Ready"]);

    fireEvent.click(screen.getByRole("button", { name: /clear/iu }));

    expect(addressOf(ports).filter.sources.size).toBe(0);
    expect(optionsOf("Ready to start")).toEqual([
      "Build the endpoint Ready",
      "Publish the SDK Ready",
    ]);
  });
});

describe("the details", () => {
  test("set an element's run state in the store", async () => {
    const ports = await synced(`${acme}&select=github%3Aacme%2Fapi%232`);

    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));

    await waitFor(async () => {
      const stored = await ports.ports.store.v1.models.load({ modelId });
      expect(stored.overlay["github:acme/api#2"]).toBe("done");
    });
    expect(
      (await cardOf("github:acme/api#2")).getAttribute("data-status"),
    ).toBe("done");
  });

  test("link the issue on GitHub and add its repository to the scope when it is outside it, then sync it", async () => {
    const ports = await synced(`${acme}&select=github%3Apartner%2Fsdk%231`);

    expect(
      (
        await screen.findByRole("link", { name: "Open the issue on GitHub" })
      ).getAttribute("href"),
    ).toBe("https://github.com/partner/sdk/issues/1");
    fireEvent.click(
      screen.getByRole("button", { name: "Add partner/sdk to the scope" }),
    );

    expect(addressOf(ports).scopes).toEqual([
      "github:acme",
      "github:partner/sdk",
    ]);
    await waitFor(() => {
      expect(ports.records.get("github:acme github:partner/sdk")).toEqual({
        modelId: "github:acme github:partner/sdk",
        gaps: [],
      });
    });
  });

  test("link an element's parent and sub-tasks, each selecting it", async () => {
    const ports = await synced(`${acme}&select=github%3Aacme%2Fweb%231`);
    /** The buttons of one side of the hierarchy, once it is read. */
    const relatives = async (
      relation: "parent" | "child",
    ): Promise<HTMLElement> =>
      waitFor(() => {
        const found = document.querySelector(`[data-hierarchy="${relation}"]`);
        if (!(found instanceof HTMLElement)) {
          throw new Error(`no ${relation} is listed yet`);
        }

        return found;
      });
    const names = (side: HTMLElement): readonly string[] =>
      within(side)
        .getAllByRole("button")
        .map((button) => button.textContent);

    const parents = await relatives("parent");
    expect(within(parents).getByRole("heading").textContent).toBe("Part of");
    expect(names(parents)).toEqual(["Ship the release"]);
    const children = await relatives("child");
    expect(within(children).getByRole("heading").textContent).toBe("Sub-tasks");
    expect(names(children)).toEqual(["Document the page"]);
    fireEvent.click(
      within(parents).getByRole("button", { name: "Ship the release" }),
    );

    expect(addressOf(ports).selected).toBe("github:acme/web#2");
    await waitFor(() => {
      expect(document.querySelector('[data-hierarchy="parent"]')).toBeNull();
    });
    expect(names(await relatives("child"))).toEqual(["Build the page"]);
  });

  test("load every repository outside the scope that an element's linked work lives in, in one step, and sync them", async () => {
    const ports = await synced(`${acme}&select=github%3Aacme%2Fweb%231`);
    const expand = await screen.findByRole("button", {
      name: "Load what this links to",
    });

    expect(
      document.getElementById(expand.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe("Adds partner/docs and partner/sdk to the scope and syncs them.");
    fireEvent.click(expand);

    expect(addressOf(ports).scopes).toEqual([
      "github:acme",
      "github:partner/docs",
      "github:partner/sdk",
    ]);
    const expanded = "github:acme github:partner/docs github:partner/sdk";
    await waitFor(() => {
      expect(ports.records.get(expanded)).toEqual({
        modelId: expanded,
        gaps: [],
      });
    });
    // An issue nothing links to arrives only with a sync of its repository.
    const stored = await ports.ports.store.v1.models.load({
      modelId: expanded,
    });
    expect(stored.model.elements.map((element) => element.id)).toContain(
      "github:partner/docs#2",
    );
  });

  test("offer no expansion once the work an element is linked to is all in the scope", async () => {
    await synced(
      `?scope=github%3Aacme&scope=github%3Apartner&select=github%3Aacme%2Fweb%231`,
    );
    await screen.findByRole("button", { name: "Mark done" });
    await waitFor(() => {
      expect(document.querySelector('[data-hierarchy="child"]')).not.toBeNull();
    });

    expect(document.querySelector('[data-screen="expand"]')).toBeNull();
  });

  test("say when a link selects an element the model does not have", async () => {
    await synced(`${acme}&select=github%3Aacme%2Fapi%2399`);

    expect(document.querySelector('[data-screen="details"]')?.textContent).toBe(
      "The selected element, github:acme/api#99, is not in this model.",
    );
    expect(
      screen.getByRole("listbox", { name: "Ready to start" }),
    ).toBeDefined();
  });
});

describe("adding to the model", () => {
  test("adds a record as the command line's add does, and shows the store's refusal", async () => {
    const ports = await synced();
    const form = screen.getByRole("region", { name: "Add to the model" });

    fireEvent.change(within(form).getByLabelText("Identifier"), {
      target: { value: "review" },
    });
    fireEvent.change(within(form).getByLabelText("Label"), {
      target: { value: "Review the release" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add activity" }));

    expect(await within(form).findByRole("status")).toHaveProperty(
      "textContent",
      "Added review.",
    );
    const stored = await ports.ports.store.v1.models.load({ modelId });
    expect(stored.model.elements.at(-1)).toEqual({
      kind: "activity",
      id: "review",
      label: "Review the release",
    });

    fireEvent.change(within(form).getByLabelText("What to add"), {
      target: { value: "transition" },
    });
    fireEvent.change(within(form).getByLabelText("From"), {
      target: { value: "nothing" },
    });
    fireEvent.change(
      within(form).getByLabelText("To, which waits on the first"),
      {
        target: { value: "review" },
      },
    );
    fireEvent.click(
      within(form).getByRole("button", { name: "Add transition" }),
    );

    await waitFor(() => {
      expect(within(form).getByRole("status").textContent).toMatch(
        /^Not added: /u,
      );
    });
  });
});

describe("a model with an illegal cycle", () => {
  test("lists the cycle in place of the view, since no status can be worked out through it", async () => {
    const ports = testPorts({ token: "t", search: acme });
    await ports.ports.store.v1.models.save({
      modelId,
      model: {
        participants: [],
        events: [],
        actions: [],
        artefacts: [],
        elements: [
          { kind: "activity", id: "a", label: "A" },
          { kind: "activity", id: "b", label: "B" },
        ],
        transitions: [
          { id: "a->b", source: "a", target: "b" },
          { id: "b->a", source: "b", target: "a" },
        ],
        fragments: [],
        projections: [],
      },
    });
    render(<App ports={ports.ports} />);

    const cycles = await screen.findByRole("list", { name: "Cycles" });
    expect(
      within(cycles)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringMatching(
        /^(A waits on B waits on A|B waits on A waits on B)$/u,
      ),
    ]);
  });
});

describe("facts", () => {
  const approved = {
    kind: "compare",
    op: "eq",
    left: { kind: "reference", key: "approved" },
    right: { kind: "booleanLiteral", value: true },
  } as const;

  /** `build` consumes `spec`, which no activity produces; the decision `gate` after it takes `ship` only when the fact `approved` is true. */
  const renderFactsModel = async (select: string): Promise<TestPorts> => {
    const ports = testPorts({
      token: "t",
      search: `${acme}&select=${select}`,
    });
    await ports.ports.store.v1.models.save({
      modelId,
      model: {
        participants: [],
        events: [],
        actions: [],
        artefacts: [{ id: "spec", name: "Specification" }],
        elements: [
          { kind: "activity", id: "build", label: "Build", consumes: ["spec"] },
          { kind: "decision", id: "gate", label: "Approved?" },
          { kind: "activity", id: "ship", label: "Ship" },
        ],
        transitions: [
          { id: "build-gate", source: "build", target: "gate" },
          {
            id: "gate-ship",
            source: "gate",
            target: "ship",
            condition: approved,
          },
        ],
        fragments: [],
        projections: [],
      },
    });
    render(<App ports={ports.ports} />);

    return ports;
  };

  const statusOf = async (id: string): Promise<string | null> =>
    (await cardOf(id)).getAttribute("data-status");

  test("record an artefact provided from the details, and its consumer becomes ready", async () => {
    const ports = await renderFactsModel("build");
    const spec = await screen.findByRole("group", { name: "Specification" });

    expect(await statusOf("build")).toBe("blocked");
    expect(
      within(spec)
        .getByRole("button", { name: "Unknown" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(within(spec).getByRole("button", { name: "Provided" }));

    await waitFor(async () => {
      expect(await statusOf("build")).toBe("ready");
    });
    await expect(
      ports.ports.store.v1.facts.read({ modelId }),
    ).resolves.toMatchObject({ facts: { artefacts: { spec: true } } });
    expect(
      within(screen.getByRole("group", { name: "Specification" }))
        .getByRole("button", { name: "Provided" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(
      within(screen.getByRole("group", { name: "Specification" })).getByRole(
        "button",
        { name: "Absent" },
      ),
    );

    await waitFor(async () => {
      expect(await statusOf("build")).toBe("blocked");
    });
  });

  test("record a fact a condition reads, and the branch follows it; unknown leaves it unknown", async () => {
    const ports = await renderFactsModel("ship");
    await ports.ports.store.v1.overlay.set({
      modelId,
      overlay: { build: "done" },
    });
    const fact = async (label: string): Promise<void> => {
      fireEvent.click(
        within(
          await screen.findByRole("group", { name: "approved" }),
        ).getByRole("button", { name: label }),
      );
    };

    await waitFor(async () => {
      expect(await statusOf("ship")).toBe("unknown");
    });

    await fact("True");
    await waitFor(async () => {
      expect(await statusOf("ship")).toBe("ready");
    });

    await fact("False");
    await waitFor(async () => {
      expect(await statusOf("ship")).toBe("skipped");
    });
    await expect(
      ports.ports.store.v1.facts.read({ modelId }),
    ).resolves.toMatchObject({
      facts: { values: { approved: { kind: "boolean", value: false } } },
    });

    await fact("Unknown");
    await waitFor(async () => {
      expect(await statusOf("ship")).toBe("unknown");
    });
    await expect(
      ports.ports.store.v1.facts.read({ modelId }),
    ).resolves.toMatchObject({ facts: { values: {} } });
  });

  test("show no artefacts or facts for an element that has none", async () => {
    await renderFactsModel("gate");

    await screen.findByRole("button", { name: "Mark done" });
    expect(screen.queryByRole("group", { name: "Specification" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Artefacts" })).toBeNull();
    expect(screen.getByRole("group", { name: "approved" })).toBeDefined();
  });
});
