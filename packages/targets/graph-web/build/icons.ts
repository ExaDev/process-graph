import { Resvg } from "@resvg/resvg-js";
import type { Plugin } from "vite";

/** The colours an icon is drawn in, taken from the theme contract's values by the caller. */
export interface IconColours {
  /** The tile behind the glyph. */
  readonly tile: string;
  /** The glyph: the process's steps and the flow between them. */
  readonly glyph: string;
}

/** Whether an icon may be cropped to a platform's mask shape (`maskable`) or is shown as drawn (`any`). */
export type IconPurpose = "any" | "maskable";

/** One icon file the app ships. */
export interface IconFile {
  /** The file's path below the app's base, as the manifest and the page name it. */
  readonly path: string;
  /** The square edge in pixels, absent for the scalable SVG. */
  readonly size: number | undefined;
  readonly purpose: IconPurpose;
  readonly type: "image/png" | "image/svg+xml";
}

/** The icon edge Chromium's install criteria name for the launcher. */
const launcherIconSize = 192;
/** The icon edge Chromium's install criteria name for the splash screen. */
const splashIconSize = 512;

/** The PNG edges a browser asks of an installable app. */
export const pngIconSizes = [launcherIconSize, splashIconSize] as const;

/** The square the glyph is drawn in, in SVG user units. Every coordinate in the glyph is in this square. */
const canvas = 100;

/** The rounding of the tile's corners for the `any` icon; a maskable icon is a full-bleed square that the platform crops. */
const cornerRadius = 22;

/**
 * The glyph: a process that starts, branches into two steps and joins again, drawn as SVG in the `canvas` square. Every step lies inside the maskable safe zone, the centred circle of radius 40% of the edge that every mask shape keeps, so one glyph serves both purposes.
 * @param colour - The glyph's colour.
 */
const glyph = (colour: string): string =>
  `<g stroke="${colour}" stroke-width="5" stroke-linecap="round" fill="${colour}">` +
  '<path d="M22 50 L50 26 L78 50 L50 74 Z" fill="none"/>' +
  '<circle cx="22" cy="50" r="8"/><circle cx="50" cy="26" r="8"/>' +
  '<circle cx="50" cy="74" r="8"/><circle cx="78" cy="50" r="8"/>' +
  "</g>";

/**
 * The app's icon as SVG: the glyph on a tile.
 * @param colours - The tile and glyph colours.
 * @param purpose - `any` draws a rounded tile; `maskable` fills the square so a platform's mask never shows a transparent corner.
 * @returns The SVG document.
 */
export const iconSvg = (colours: IconColours, purpose: IconPurpose): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(canvas)} ${String(canvas)}">`,
    `<rect width="${String(canvas)}" height="${String(canvas)}" rx="${String(purpose === "any" ? cornerRadius : 0)}" fill="${colours.tile}"/>`,
    glyph(colours.glyph),
    "</svg>",
  ].join("");

/**
 * Every icon file the app ships: the scalable SVG for the page, and a PNG of each install size for each purpose.
 * @returns The files, in the order the manifest lists them.
 */
export const iconFiles = (): readonly IconFile[] => [
  {
    path: "icons/icon.svg",
    size: undefined,
    purpose: "any",
    type: "image/svg+xml",
  },
  ...(["any", "maskable"] as const).flatMap((purpose) =>
    pngIconSizes.map((size): IconFile => ({
      path: `icons/${purpose}-${String(size)}.png`,
      size,
      purpose,
      type: "image/png",
    })),
  ),
];

/**
 * Renders one icon file's bytes: the SVG as text, or the SVG rasterised to its PNG edge by resvg.
 * @param file - The icon file.
 * @param colours - The tile and glyph colours.
 * @returns The file's content.
 */
export const renderIcon = (
  file: IconFile,
  colours: IconColours,
): string | Uint8Array => {
  const svg = iconSvg(colours, file.purpose);
  if (file.size === undefined) {
    return svg;
  }

  return new Resvg(svg, { fitTo: { mode: "width", value: file.size } })
    .render()
    .asPng();
};

/**
 * The Vite plugin that makes the icons: at build time it renders every icon file and emits it into the bundle, where the service worker's precache finds it; the dev server answers the same paths from memory. Nothing is written to the source tree, so no generated image is ever committed.
 * @param colours - The tile and glyph colours.
 * @returns The plugin.
 */
export const pwaIcons = (colours: IconColours): Plugin => ({
  name: "process-graph-web-icons",
  generateBundle() {
    for (const file of iconFiles()) {
      this.emitFile({
        type: "asset",
        fileName: file.path,
        source: renderIcon(file, colours),
      });
    }
  },
  configureServer(server) {
    const base = server.config.base;
    server.middlewares.use((request, response, next) => {
      const file = iconFiles().find(
        (candidate) => request.url === `${base}${candidate.path}`,
      );
      if (file === undefined) {
        next();

        return;
      }
      response.setHeader("content-type", file.type);
      response.end(renderIcon(file, colours));
    });
  },
});
