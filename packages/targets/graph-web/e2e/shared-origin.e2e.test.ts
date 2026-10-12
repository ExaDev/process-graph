import { expect, type Page } from "@playwright/test";
import { fixtureToken } from "./github-fixture.ts";
import { card, syncFinished, syncScopes, test } from "./support.ts";

const sharedOrigin = "https://exadev.github.io";

/** What the page has kept on the device, read from the browser's own storage APIs. */
const kept = async (page: Page) =>
  page.evaluate(async () => {
    const opfsRoot = await navigator.storage.getDirectory();
    const opfsEntries: string[] = [];
    for await (const name of opfsRoot.keys()) {
      opfsEntries.push(name);
    }

    return {
      localStorage: window.localStorage.length,
      sessionStorage: window.sessionStorage.length,
      databases: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
      opfsEntries,
      serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
    };
  });

test("on a shared github.io origin a sync works and persists nothing", async ({
  page,
  context,
  baseURL,
}) => {
  // The browser addresses the shared origin; each request is answered with the same path from the local preview of the root build.
  await context.route(`${sharedOrigin}/**`, async (route) => {
    const { pathname, search } = new URL(route.request().url());
    const response = await route.fetch({
      url: `${baseURL ?? ""}${pathname}${search}`,
    });
    await route.fulfill({ response });
  });
  const workers: string[] = [];
  page.on("worker", (worker) => {
    workers.push(worker.url());
  });

  await page.goto(`${sharedOrigin}/`);
  await expect(page.locator('[data-notice="ephemeral"]')).toContainText(
    "keeps nothing between visits",
  );
  await syncScopes(page, fixtureToken, ["acme"], "Use for this visit");
  await syncFinished(page);
  await expect(card(page, "github:acme/web#1")).toHaveAttribute(
    "data-status",
    "blocked",
  );

  expect(await kept(page)).toEqual({
    localStorage: 0,
    sessionStorage: 0,
    databases: 0,
    caches: 0,
    opfsEntries: [],
    serviceWorkers: 0,
  });
  expect(workers).toEqual([]);

  // Nothing survives a reload: the token is asked for again and the sync is gone.
  await page.reload();
  await expect(page.getByLabel("Token", { exact: true })).toBeVisible();
  await expect(card(page, "github:acme/web#1")).toHaveCount(0);
});

test("the same flow on an origin of its own persists, so the check above can fail", async ({
  page,
}) => {
  await page.goto("/");
  await syncScopes(page, fixtureToken, ["acme"]);
  await syncFinished(page);

  const state = await kept(page);
  expect(state.localStorage).toBeGreaterThan(0);
  expect(state.opfsEntries).not.toEqual([]);
});
