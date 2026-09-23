import { describe, expect, it } from "vitest";
import { analyzeThumbnailPixels } from "./thumbnail.js";

function pixels(
  width: number,
  height: number,
  value: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue] = value(x, y);
      result.set([red, green, blue, 255], offset);
    }
  }
  return result;
}

describe("analyzeThumbnailPixels", () => {
  it("reports a dark flat image as low contrast", () => {
    const result = analyzeThumbnailPixels(
      pixels(8, 8, () => [10, 10, 10]),
      8,
      8,
    );
    expect(result.brightness).toBeLessThan(10);
    expect(result.contrast).toBe(0);
    expect(result.edgeDensity).toBe(0);
  });

  it("detects contrast and edges in a checkerboard", () => {
    const result = analyzeThumbnailPixels(
      pixels(12, 12, (x, y) => ((x + y) % 2 === 0 ? [245, 60, 30] : [5, 10, 30])),
      12,
      12,
    );
    expect(result.contrast).toBeGreaterThan(50);
    expect(result.edgeDensity).toBeGreaterThan(50);
    expect(result.score).toBeGreaterThan(0);
  });

  it("returns a safe empty result for invalid input", () => {
    expect(analyzeThumbnailPixels(new Uint8ClampedArray(), 0, 0).score).toBe(0);
  });
});
