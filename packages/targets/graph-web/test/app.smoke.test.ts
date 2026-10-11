import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";

// Reads the built dist/, not src/: the check that the build emitted an installable app, with its icons rendered, its service worker precaching the shell and the SQLite wasm, and its pages pointing at both.

const dist = join(import.meta.dirname, "../dist");
const read = (path: string): string => readFileSync(join(dist, path), "utf8");

const manifestSchema = z.object({
  name: z.string(),
  short_name: z.string(),
  start_url: z.string(),
  scope: z.string(),
  display: z.literal("standalone"),
  theme_color: z.string(),
  background_color: z.string(),
  icons: z.array(
    z.object({
      src: z.string(),
      sizes: z.string(),
      type: z.string(),
      purpose: z.string(),
    }),
  ),
});

/** The PNG signature, then the IHDR chunk, whose data starts with the width and height as big-endian 32-bit integers. */
const pngSignature = "89504e470d0a1a0a";
const widthOffset = 16;
const heightOffset = 20;

describe("the built app", () => {
  const manifest = manifestSchema.parse(
    JSON.parse(read("manifest.webmanifest")),
  );

  test("has a manifest an installable app needs, scoped to the base path", () => {
    expect(manifest).toMatchObject({
      name: "Process graph",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(
      manifest.icons.map(
        (icon) => `${icon.purpose} ${icon.sizes} ${icon.type}`,
      ),
    ).toEqual([
      "any 192x192 image/png",
      "any 512x512 image/png",
      "maskable 192x192 image/png",
      "maskable 512x512 image/png",
    ]);
  });

  test("rendered every icon the manifest names as a PNG of its stated size", () => {
    for (const icon of manifest.icons) {
      const bytes = readFileSync(join(dist, icon.src));
      expect(bytes.subarray(0, pngSignature.length / 2).toString("hex")).toBe(
        pngSignature,
      );
      expect(
        `${String(bytes.readUInt32BE(widthOffset))}x${String(bytes.readUInt32BE(heightOffset))}`,
      ).toBe(icon.sizes);
    }
    expect(existsSync(join(dist, "icons/icon.svg"))).toBe(true);
  });

  test("precaches the page, the icons and the SQLite wasm in its service worker", () => {
    const worker = read("sw.js");

    expect(worker).toContain('"index.html"');
    expect(worker).toMatch(/assets\/sqlite3-[\w-]+\.wasm/u);
    for (const icon of manifest.icons) {
      expect(worker).toContain(`"${icon.src}"`);
    }
  });

  test("links the manifest and the icon from the page", () => {
    const page = read("index.html");

    expect(page).toContain(
      '<link rel="manifest" href="/manifest.webmanifest">',
    );
    expect(page).toContain('href="icons/icon.svg"');
  });
});
