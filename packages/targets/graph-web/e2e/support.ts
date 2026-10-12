import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";
import { startGitHubFixture, type GitHubFixture } from "./github-fixture.ts";

export const githubApiHost = "api.github.com";

// What the end-to-end tests that run the app against the GitHub fixture share.

/** Every test gets its own fixture server, and its browser context's requests to GitHub's API are answered by it. Playwright forwards the request from the test process, so the browser's own request still goes to api.github.com. */
export const test = base.extend<{ readonly github: GitHubFixture }>({
  github: [
    async ({ context }, use) => {
      const fixture = await startGitHubFixture();
      await context.route(`https://${githubApiHost}/**`, async (route) => {
        const response = await route.fetch({ url: fixture.url });
        await route.fulfill({ response });
      });
      await use(fixture);
      await fixture.close();
    },
    { auto: true },
  ],
});

/** An element's card on the canvas. */
export const card = (page: Page, id: string): Locator =>
  page.locator(`.react-flow__node [data-element-id="${id}"]`);

/** Saves a token, adds the scopes and starts their sync. */
export const syncScopes = async (
  page: Page,
  token: string,
  scopes: readonly string[],
  saveButton = "Save on this device",
): Promise<void> => {
  await page.getByLabel("Token", { exact: true }).fill(token);
  await page.getByRole("button", { name: saveButton }).click();
  // Each scope is added after the one before, as a person would add them.
  await scopes.reduce(async (previous, scope) => {
    await previous;
    await page
      .getByLabel("Add an organisation, user or repository")
      .fill(scope);
    await page.getByRole("button", { name: "Add", exact: true }).click();
  }, Promise.resolve());
  await page.getByRole("button", { name: "Sync", exact: true }).click();
};

export const syncFinished = async (page: Page): Promise<void> => {
  await expect(page.locator("[data-progress]")).toContainText("Sync finished");
};

/** Waits until a service worker is active for the page's scope, so a reload is served from its precache. */
export const serviceWorkerActive = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
};
