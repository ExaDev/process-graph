import { type Request } from "@playwright/test";
import { fixtureToken, rateLimitedToken } from "./github-fixture.ts";
import {
  card,
  githubApiHost,
  serviceWorkerActive,
  syncFinished,
  syncScopes,
  test,
} from "./support.ts";

import { expect } from "@playwright/test";

test("syncs organisations across their repositories, draws the work and lists what is ready and blocked", async ({
  page,
}) => {
  await page.goto("/");
  await syncScopes(page, fixtureToken, ["acme", "github:ghost"]);
  await syncFinished(page);

  await expect(card(page, "github:acme/web#2")).toHaveAttribute(
    "data-status",
    "blocked",
  );
  await expect(card(page, "github:acme/api#1")).toHaveAttribute(
    "data-status",
    "done",
  );
  // A dependency in another organisation's repository is followed across organisations.
  await expect(card(page, "github:partner/sdk#1")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await expect(
    page.getByRole("listbox", { name: "Ready to start" }),
  ).toHaveText(/Build the endpoint.*Publish the SDK/su);
  await page.getByRole("tab", { name: "Blocked" }).click();
  await expect(
    page.getByRole("listbox", { name: "Blocked" }).getByRole("option"),
  ).toHaveText([
    /Build the page.*waits on Build the endpoint, Publish the SDK/su,
    /Ship the release.*waits on Build the endpoint, Publish the SDK/su,
  ]);
  // The owner that does not exist is a gap beside the rest.
  await expect(page.locator('[data-notice="gaps"] [data-gap]')).toHaveText([
    /github:ghost: not found/u,
  ]);
  expect(new URL(page.url()).searchParams.getAll("scope")).toEqual([
    "github:acme",
    "github:ghost",
  ]);
  expect(new URL(page.url()).searchParams.get("list")).toBe("blocked");
});

test("sends the token to GitHub's API and to nothing else", async ({
  page,
  context,
}) => {
  const requests: Request[] = [];
  context.on("request", (request) => {
    requests.push(request);
  });
  await page.goto("/");
  await syncScopes(page, fixtureToken, ["acme"]);
  await syncFinished(page);

  const carrying = await Promise.all(
    requests.map(async (request) => {
      const headers = await request.allHeaders();
      const text = [
        request.url(),
        request.postData() ?? "",
        ...Object.values(headers),
      ].join("\n");

      return {
        host: new URL(request.url()).hostname,
        carries: text.includes(fixtureToken),
      };
    }),
  );
  const withToken = carrying.filter((request) => request.carries);
  expect(withToken.length).toBeGreaterThan(0);
  expect(new Set(withToken.map((request) => request.host))).toEqual(
    new Set([githubApiHost]),
  );
});

test("is installable: a manifest with install icons, served without cross-origin isolation, and an active service worker", async ({
  page,
  context,
}) => {
  const response = await page.goto("/");
  expect(response?.headers()["cross-origin-opener-policy"]).toBeUndefined();
  expect(response?.headers()["cross-origin-embedder-policy"]).toBeUndefined();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  await serviceWorkerActive(page);

  const session = await context.newCDPSession(page);
  const { installabilityErrors } = await session.send(
    "Page.getInstallabilityErrors",
  );
  expect(installabilityErrors).toEqual([]);
  const manifest: unknown = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest).toMatchObject({
    name: "Process graph",
    display: "standalone",
    start_url: "/",
    scope: "/",
  });
  const icon = await page.request.get("/icons/maskable-512.png");
  expect(icon.headers()["content-type"]).toBe("image/png");
});

test("shows the last sync after an offline reload", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await serviceWorkerActive(page);
  await syncScopes(page, fixtureToken, ["acme"]);
  await syncFinished(page);
  await expect(card(page, "github:acme/web#1")).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('[data-notice="offline"]')).toBeVisible();
  await expect(card(page, "github:acme/web#1")).toHaveAttribute(
    "data-status",
    "blocked",
  );
  await expect(page.getByRole("button", { name: "Sync again" })).toBeDisabled();
  await context.setOffline(false);
});

test("a run state set in one tab shows in another", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await syncScopes(page, fixtureToken, ["acme"]);
  await syncFinished(page);

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(card(other, "github:acme/api#2")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await other
    .getByRole("listbox", { name: "Ready to start" })
    .getByRole("option", { name: /Build the endpoint/u })
    .click();
  await other.getByRole("button", { name: "Mark done" }).click();

  await expect(card(page, "github:acme/api#2")).toHaveAttribute(
    "data-status",
    "done",
  );
  await expect(
    page.getByRole("listbox", { name: "Ready to start" }),
  ).not.toContainText("Build the endpoint");
});

test("expands the scope on demand to a repository a dependency leads to", async ({
  page,
}) => {
  await page.goto("/");
  await syncScopes(page, fixtureToken, ["acme"]);
  await syncFinished(page);

  await page
    .getByRole("listbox", { name: "Ready to start" })
    .getByRole("option", { name: /Publish the SDK/u })
    .click();
  await page
    .getByRole("button", { name: "Add partner/sdk to the scope" })
    .click();

  await syncFinished(page);
  expect(new URL(page.url()).searchParams.getAll("scope")).toEqual([
    "github:acme",
    "github:partner/sdk",
  ]);
  await expect(card(page, "github:partner/sdk#1")).toBeVisible();
});

test("loads every repository an issue's linked work lives in, in one step, and shows its sub-tasks", async ({
  page,
}) => {
  await page.goto("/");
  await syncScopes(page, fixtureToken, ["acme"]);
  await syncFinished(page);

  await page.getByRole("tab", { name: "Blocked" }).click();
  await page
    .getByRole("listbox", { name: "Blocked" })
    .getByRole("option", { name: /Build the page/u })
    .click();
  const details = page.locator('[data-screen="details"]');
  // The sub-issue in another organisation's repository is read as a stub with the page that reaches it.
  await expect(
    details.locator('[data-hierarchy="child"]').getByRole("button"),
  ).toHaveText(["Document the page"]);
  await expect(card(page, "github:partner/docs#2")).toHaveCount(0);
  await details
    .getByRole("button", { name: "Load what this links to" })
    .click();

  await syncFinished(page);
  expect(new URL(page.url()).searchParams.getAll("scope")).toEqual([
    "github:acme",
    "github:partner/docs",
    "github:partner/sdk",
  ]);
  // An issue nothing links to arrives only with a sync of its whole repository.
  await expect(card(page, "github:partner/docs#2")).toBeVisible();
  await expect(card(page, "github:partner/sdk#1")).toBeVisible();
});

test("says when GitHub's rate limit resets", async ({ page }) => {
  await page.goto("/");
  await syncScopes(page, rateLimitedToken, ["acme"]);

  await expect(page.locator('[data-notice="rate-limited"]')).toContainText(
    "the limit resets at",
  );
  // The tests run in UTC with British English formats (playwright.config.ts), so the reset instant reads the same everywhere.
  await expect(page.locator('[data-notice="rate-limited"]')).toContainText(
    "1 Jan 2100",
  );
});

test("syncs a Projects v2 board pasted as its link, passing over its draft items", async ({
  page,
}) => {
  await page.goto("/");
  await syncScopes(page, fixtureToken, [
    "https://github.com/orgs/acme/projects/1",
  ]);
  await syncFinished(page);

  expect(new URL(page.url()).searchParams.getAll("scope")).toEqual([
    "github:acme/projects/1",
  ]);
  // The board's issues, and the issues they wait on, which are read whatever board they are on.
  await expect(card(page, "github:acme/web#2")).toHaveAttribute(
    "data-status",
    "blocked",
  );
  await expect(card(page, "github:acme/api#2")).toHaveAttribute(
    "data-status",
    "ready",
  );
  await expect(card(page, "github:acme/web#1")).toBeVisible();
});

test("suggests the organisations the token reaches and their repositories", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Token", { exact: true }).fill(fixtureToken);
  await page.getByRole("button", { name: "Save on this device" }).click();
  const suggestions = page.getByRole("region", { name: "Suggestions" });
  await suggestions
    .getByRole("button", { name: "Show my account and organisations" })
    .click();
  await expect(
    suggestions
      .getByRole("list", { name: "Your scopes" })
      .getByRole("listitem"),
  ).toHaveText([/^Alice/u, /^acme/u, /^partner/u]);
  await suggestions
    .getByRole("button", { name: "Show the repositories of github:acme" })
    .click();
  await suggestions
    .getByRole("button", { name: "Add github:acme/web" })
    .click();

  expect(new URL(page.url()).searchParams.getAll("scope")).toEqual([
    "github:acme/web",
  ]);
});
