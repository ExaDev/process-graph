import { afterEach, describe, expect, test, vi } from "vitest";
import { ephemeralPersistence, persistenceAllowed } from "./persistence.ts";

/** The navigator properties a test replaced, removed again afterwards. */
const replacedOnNavigator = ["storage", "serviceWorker"] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const property of replacedOnNavigator) {
    Reflect.deleteProperty(window.navigator, property);
  }
});

describe("the persistence policy", () => {
  test.each(["exadev.github.io", "someone.github.io", "Someone.GitHub.io"])(
    "forbids persisting on the shared origin %s",
    (hostname) => {
      expect(persistenceAllowed({ hostname })).toBe(false);
    },
  );

  test.each([
    "localhost",
    "127.0.0.1",
    "graph.example.com",
    "github.io.example.com",
    "notgithub.io",
  ])("allows persisting on %s", (hostname) => {
    expect(persistenceAllowed({ hostname })).toBe(true);
  });
});

/** A stand-in for a browser storage API that fails the test on any use. */
const forbidden = (name: string): object =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(`${name}.${String(property)} was used`);
      },
    },
  );

describe("the ephemeral ports", () => {
  test("keep the token, the settings and the sync records in memory and touch no browser storage", async () => {
    const storageCalls = [
      vi.spyOn(Storage.prototype, "getItem"),
      vi.spyOn(Storage.prototype, "setItem"),
      vi.spyOn(Storage.prototype, "removeItem"),
      vi.spyOn(Storage.prototype, "clear"),
    ];
    vi.stubGlobal("indexedDB", forbidden("indexedDB"));
    vi.stubGlobal("caches", forbidden("caches"));
    for (const property of replacedOnNavigator) {
      Object.defineProperty(window.navigator, property, {
        configurable: true,
        value: forbidden(`navigator.${property}`),
      });
    }

    const ports = ephemeralPersistence();

    expect(ports.token.read()).toBeUndefined();
    ports.token.write("a-token");
    expect(ports.token.read()).toBe("a-token");
    ports.token.clear();
    expect(ports.token.read()).toBeUndefined();

    expect(ports.themePreference.read()).toBe("system");
    ports.themePreference.write("dark");
    expect(ports.themePreference.read()).toBe("dark");

    const record = { modelId: "github:acme", gaps: [] };
    ports.syncRecords.write(record);
    expect(ports.syncRecords.read("github:acme")).toBe(record);
    expect(ports.syncRecords.read("github:other")).toBeUndefined();

    expect(ports.updates.available.get()).toBe(false);
    expect(() => {
      ports.updates.apply();
    }).not.toThrow();

    // The in-memory store answers, here with its own "no such model" for a model nothing has synced.
    await expect(
      ports.store.v1.query.ancestors({
        modelId: "github:acme",
        element: "github:acme/web#1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    for (const call of storageCalls) {
      expect(call).not.toHaveBeenCalled();
    }
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
  });

  test("hold nothing between two instances", () => {
    ephemeralPersistence().token.write("a-token");

    expect(ephemeralPersistence().token.read()).toBeUndefined();
  });
});
