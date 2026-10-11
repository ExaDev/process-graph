import { describe, expect, test } from "vitest";
import { iconFiles, iconSvg, pngIconSizes, renderIcon } from "./icons.ts";

const colours = { tile: "#0969da", glyph: "#ffffff" };
const [launcher, splash] = pngIconSizes;

/** Where a PNG's IHDR chunk keeps the image's width and height, as big-endian 32-bit integers after the signature and the chunk's length and type. */
const widthOffset = 16;
const heightOffset = 20;

describe("the app's icons", () => {
  test("are the scalable SVG and a PNG of each install size for each purpose", () => {
    expect(
      iconFiles().map((file) => [
        file.path,
        file.size,
        file.purpose,
        file.type,
      ]),
    ).toEqual([
      ["icons/icon.svg", undefined, "any", "image/svg+xml"],
      ["icons/any-192.png", launcher, "any", "image/png"],
      ["icons/any-512.png", splash, "any", "image/png"],
      ["icons/maskable-192.png", launcher, "maskable", "image/png"],
      ["icons/maskable-512.png", splash, "maskable", "image/png"],
    ]);
  });

  test("draw the tile in the theme's colours, rounded unless a platform masks it", () => {
    const any = iconSvg(colours, "any");
    const maskable = iconSvg(colours, "maskable");

    expect(any).toContain('rx="22" fill="#0969da"');
    expect(maskable).toContain('rx="0" fill="#0969da"');
    expect(any).toContain('stroke="#ffffff"');
  });

  test("rasterise each PNG at its own size", () => {
    for (const file of iconFiles()) {
      const content = renderIcon(file, colours);
      if (file.size === undefined) {
        expect(content).toBe(iconSvg(colours, file.purpose));
        continue;
      }
      if (typeof content === "string") {
        throw new Error(`${file.path} rendered as text`);
      }
      const view = new DataView(content.buffer, content.byteOffset);
      expect([
        view.getUint32(widthOffset),
        view.getUint32(heightOffset),
      ]).toEqual([file.size, file.size]);
    }
  });
});
