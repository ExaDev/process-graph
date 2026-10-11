import {
  createFakeGraphSource,
  GraphSourceError,
  type GraphSourcePager,
} from "@exadev/process-graph-source-contract";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { App } from "./app.tsx";
import { formatInstant } from "./format.ts";
import { fakeScopes, testPorts, type TestPorts } from "./test-support/ports.ts";
import { parseViewState } from "./url-state.ts";

afterEach(cleanup);

const acme = "?scope=github%3Aacme";

const renderApp = (under: TestPorts) => render(<App ports={under.ports} />);

/** The address's view state, as the app last wrote it. */
const addressOf = (under: TestPorts) =>
  parseViewState(under.address.observable.get()).state;

/** Starts a sync and waits for it to finish. */
const syncNow = async (): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  await waitFor(() => {
    expect(document.querySelector("[data-progress]")?.textContent).toContain(
      "Sync finished",
    );
  });
};

/** An element's card on the canvas, once the view is laid out. */
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

describe("the token screen", () => {
  test("is shown until a token is saved, says what the token needs and where it goes, and never shows it back", () => {
    const ports = testPorts();
    renderApp(ports);
    const panel = screen.getByRole("region", { name: "GitHub token" });

    expect(panel.textContent).toContain(
      "read-only Issues and Metadata permissions",
    );
    expect(panel.textContent).toContain(
      "It is sent to api.github.com and nowhere else",
    );

    fireEvent.change(within(panel).getByLabelText("Token"), {
      target: { value: "  secret-token  " },
    });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Save on this device" }),
    );

    expect(ports.savedToken()).toBe("secret-token");
    expect(screen.queryByRole("region", { name: "GitHub token" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "GitHub token" }));
    const reopened = screen.getByRole("region", { name: "GitHub token" });
    expect(within(reopened).getByLabelText("Replace the token")).toHaveProperty(
      "value",
      "",
    );
    expect(document.body.textContent).not.toContain("secret-token");

    fireEvent.click(
      within(reopened).getByRole("button", { name: "Forget the token" }),
    );
    expect(ports.savedToken()).toBeUndefined();
  });
});

describe("the scope picker", () => {
  test("adds organisations and repositories to the address, in order, and removes them", () => {
    const ports = testPorts({ token: "t" });
    renderApp(ports);
    const input = screen.getByLabelText(
      "Add an organisation, user or repository",
    );

    fireEvent.change(input, { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(input, {
      target: { value: "https://github.com/partner/sdk/issues/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(addressOf(ports).scopes).toEqual([
      "github:acme",
      "github:partner/sdk",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove github:acme" }));
    expect(addressOf(ports).scopes).toEqual(["github:partner/sdk"]);
  });

  test("says why a scope cannot be added", () => {
    renderApp(testPorts({ token: "t" }));

    fireEvent.change(
      screen.getByLabelText("Add an organisation, user or repository"),
      {
        target: { value: "acme/api/extra" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert").textContent).toBe(
      '"acme/api/extra" is not a GitHub organisation, user or repository: write owner or owner/repo.',
    );
  });
});

describe("the sync", () => {
  test("says nothing is synced yet, then syncs with the saved token and shows the work", async () => {
    const ports = testPorts({ token: "t", search: acme });
    renderApp(ports);

    expect(
      (await screen.findByText(/Nothing has been synced for this scope/u))
        .textContent,
    ).toContain("Sync to read it");
    await syncNow();

    expect(document.querySelector("[data-progress]")?.textContent).toBe(
      "Sync finished. 2 pages read: 5 issues and 4 dependencies written.",
    );
    expect(
      (await cardOf("github:acme/web#2")).getAttribute("data-status"),
    ).toBe("blocked");
    expect(ports.tokensUsed).toEqual(["t"]);
    expect(ports.records.get("github:acme")).toEqual({
      modelId: "github:acme",
      gaps: [],
    });
  });

  test("is cancelled by the cancel button and resumed from where it stopped", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeGraphSource({
      source: "github",
      scopes: fakeScopes,
    });
    const paused: GraphSourcePager = {
      source: "github",
      page: async (request) => {
        if (request.cursor !== undefined) {
          await gate;
          request.signal?.throwIfAborted();
        }

        return fake.page(request);
      },
    };
    const ports = testPorts({ token: "t", search: acme, pager: paused });
    renderApp(ports);

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    await waitFor(() => {
      expect(document.querySelector("[data-progress]")?.textContent).toBe(
        "Syncing. 1 page read: 2 issues and 1 dependency written.",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    release();
    await waitFor(() => {
      expect(document.querySelector("[data-progress]")?.textContent).toBe(
        "Sync cancelled. 1 page read: 2 issues and 1 dependency written. Resume to carry on.",
      );
    });
    expect(ports.records.get("github:acme")?.checkpoint).toEqual({
      modelId: "github:acme",
      scopes: ["github:acme"],
      source: "github",
      after: "github%3Aacme@0",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Resume where it stopped" }),
    );
    await waitFor(() => {
      expect(document.querySelector("[data-progress]")?.textContent).toBe(
        "Sync finished. 1 page read: 4 issues and 3 dependencies written.",
      );
    });
    expect(ports.records.get("github:acme")?.checkpoint).toBeUndefined();
  });

  test("offers to resume a sync a reload interrupted, from the record on the device", () => {
    renderApp(
      testPorts({
        token: "t",
        search: acme,
        records: [
          {
            modelId: "github:acme",
            gaps: [],
            checkpoint: {
              modelId: "github:acme",
              scopes: ["github:acme"],
              source: "github",
              after: "github%3Aacme@0",
            },
          },
        ],
      }),
    );

    expect(
      screen.getByRole("button", { name: "Resume where it stopped" }),
    ).toBeDefined();
    expect(document.querySelector("[data-progress]")?.textContent).toBe(
      "The last sync stopped before it finished.",
    );
  });
});

describe("the notices", () => {
  const failing = (
    failure: ConstructorParameters<typeof GraphSourceError>[0],
  ) =>
    testPorts({
      token: "t",
      search: acme,
      pager: {
        source: "github",
        page: async () => Promise.reject(new GraphSourceError(failure)),
      },
    });

  test("says when GitHub's rate limit resets", async () => {
    renderApp(
      failing({
        kind: "rate-limited",
        message: "rate limited",
        resetAt: "2100-01-01T00:00:00.000Z",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    await waitFor(() => {
      expect(
        document.querySelector('[data-notice="rate-limited"]')?.textContent,
      ).toBe(
        `GitHub is rate limiting requests; the limit resets at ${formatInstant("2100-01-01T00:00:00.000Z")}. What was read before it stopped is kept. Resume the sync then.`,
      );
    });
  });

  test("offers to change a token GitHub refused", async () => {
    renderApp(failing({ kind: "unauthorised", message: "Bad credentials" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    const notice = await waitFor(() => {
      const found = document.querySelector('[data-notice="unauthorised"]');
      if (!(found instanceof HTMLElement)) {
        throw new Error("no notice yet");
      }

      return found;
    });
    fireEvent.click(
      within(notice).getByRole("button", { name: "Change the token" }),
    );

    expect(screen.getByRole("region", { name: "GitHub token" })).toBeDefined();
  });

  test("lists the parts of the scope the source could not read", async () => {
    renderApp(
      testPorts({ token: "t", search: `${acme}&scope=github%3Aghost` }),
    );
    await syncNow();

    expect(
      [...document.querySelectorAll('[data-notice="gaps"] [data-gap]')].map(
        (gap) => gap.textContent,
      ),
    ).toEqual(["github:ghost: not found. github:ghost does not exist"]);
  });

  test("says when the page is offline and holds the sync until it is back", () => {
    const ports = testPorts({ token: "t", search: acme });
    renderApp(ports);

    act(() => {
      ports.online.set(false);
    });

    expect(
      document.querySelector('[data-notice="offline"]')?.textContent,
    ).toContain("You are offline");
    expect(screen.getByRole("button", { name: "Sync" })).toHaveProperty(
      "disabled",
      true,
    );

    act(() => {
      ports.online.set(true);
    });
    expect(document.querySelector('[data-notice="offline"]')).toBeNull();
  });

  test("offers a new version and loads it only when asked", () => {
    const ports = testPorts();
    renderApp(ports);

    act(() => {
      ports.updateAvailable.set(true);
    });
    expect(ports.updatesApplied()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Reload to update" }));

    expect(ports.updatesApplied()).toBe(1);
  });

  test("names the parts of a link it could not use", () => {
    renderApp(testPorts({ search: "?view=gantt&scope=acme" }));

    expect(
      [...document.querySelectorAll('[data-notice="link"] li')].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      'The scope "acme" names no source; write it as source:scope, such as github:owner/repo.',
      'The view "gantt" is not one of flowchart, swimlane, state, sequence.',
    ]);
  });
});

describe("the theme", () => {
  test("follows the system until a person picks one, and remembers the pick", () => {
    const ports = testPorts();
    const { container } = renderApp(ports);
    const themed = () =>
      container.querySelector("[data-theme]")?.getAttribute("data-theme");

    expect(themed()).toBe("light");
    act(() => {
      ports.prefersDark.set(true);
    });
    expect(themed()).toBe("dark");

    fireEvent.change(screen.getByLabelText("Theme"), {
      target: { value: "light" },
    });

    expect(themed()).toBe("light");
    expect(ports.ports.themePreference.read()).toBe("light");
  });
});
