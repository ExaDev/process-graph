import { afterEach, describe, expect, test, vi } from "vitest";
import {
  browserAddressBar,
  browserOnline,
  localSyncRecords,
  localThemePreference,
  localTokenStore,
  serviceWorkerUpdates,
} from "./browser.ts";

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("the device's storage", () => {
  test("keeps the token until it is cleared, under the app's own key", () => {
    const tokens = localTokenStore(window.localStorage);

    expect(tokens.read()).toBeUndefined();
    tokens.write("a-token");
    expect(tokens.read()).toBe("a-token");
    expect(window.localStorage.getItem("process-graph:github-token")).toBe(
      "a-token",
    );
    tokens.clear();
    expect(tokens.read()).toBeUndefined();
  });

  test("keeps each model's sync record, and reads a record that no longer fits its schema as absent", () => {
    const records = localSyncRecords(window.localStorage);
    const record = {
      modelId: "github:acme",
      gaps: [{ target: "github:ghost", reason: "not-found", message: "gone" }],
      checkpoint: {
        modelId: "github:acme",
        scopes: ["github:acme"],
        source: "github",
        after: "cursor",
      },
    } as const;

    records.write(record);
    expect(records.read("github:acme")).toEqual(record);
    expect(records.read("github:other")).toBeUndefined();

    window.localStorage.setItem(
      "process-graph:sync:github:old",
      JSON.stringify({ modelId: "github:old", cursor: "from an older app" }),
    );
    expect(records.read("github:old")).toBeUndefined();
  });

  test("follows the system's theme until one is chosen", () => {
    const theme = localThemePreference(window.localStorage);

    expect(theme.read()).toBe("system");
    theme.write("dark");
    expect(theme.read()).toBe("dark");
    window.localStorage.setItem("process-graph:theme", "sepia");
    expect(theme.read()).toBe("system");
  });
});

describe("the address bar", () => {
  test("replaces the query without a history entry and tells its listeners", () => {
    window.history.replaceState(null, "", "/app/?view=flowchart#top");
    const address = browserAddressBar(window);
    const listener = vi.fn<() => void>();
    const unsubscribe = address.search.subscribe(listener);
    const entries = window.history.length;

    address.replace("?view=swimlane");

    expect(address.search.get()).toBe("?view=swimlane");
    expect(window.location.pathname).toBe("/app/");
    expect(window.location.hash).toBe("#top");
    expect(window.history.length).toBe(entries);
    expect(listener).toHaveBeenCalledTimes(1);

    address.replace("?view=swimlane");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    address.replace("");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("the network", () => {
  test("follows the browser's online and offline events", () => {
    const online = browserOnline(window);
    const listener = vi.fn<() => void>();
    online.subscribe(listener);

    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(online.get()).toBe(window.navigator.onLine);
  });
});

describe("service worker updates", () => {
  test("reports a waiting version and activates it only when asked", async () => {
    let needRefresh: () => void = () => undefined;
    const update = vi.fn<(reload?: boolean) => Promise<void>>(async () =>
      Promise.resolve(),
    );
    const updates = serviceWorkerUpdates((options) => {
      needRefresh = options.onNeedRefresh;

      return update;
    });
    const listener = vi.fn<() => void>();
    updates.available.subscribe(listener);

    expect(updates.available.get()).toBe(false);
    needRefresh();
    expect(updates.available.get()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();

    updates.apply();
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith(true);
  });
});
