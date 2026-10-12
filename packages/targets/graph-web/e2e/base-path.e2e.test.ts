import { expect, test } from "@playwright/test";
import { basePath } from "./base-path.ts";

// Runs against the build made with `GRAPH_WEB_BASE` set to a sub-path (see base-path-build.ts), served as a project site serves it, under the sub-path.

test("serves the shell, manifest and service worker under the base path and requests nothing outside it", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "").origin;
  const paths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin) {
      paths.push(url.pathname);
    }
  });

  await page.goto(basePath);
  await expect(page.getByLabel("Token", { exact: true })).toBeVisible();
  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;

    return registration.scope;
  });
  expect(scope).toBe(`${origin}${basePath}`);

  const manifestLink = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestLink).toBe(`${basePath}manifest.webmanifest`);
  const manifest: unknown = await (
    await page.request.get(`${basePath}manifest.webmanifest`)
  ).json();
  expect(manifest).toMatchObject({ start_url: basePath, scope: basePath });
  const icon = await page.request.get(`${basePath}icons/maskable-512.png`);
  expect(icon.headers()["content-type"]).toBe("image/png");

  expect(paths).not.toHaveLength(0);
  expect(paths.filter((path) => !path.startsWith(basePath))).toEqual([]);
});
