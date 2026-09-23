export interface ThumbnailDiagnostics {
  brightness: number;
  contrast: number;
  saturation: number;
  edgeDensity: number;
  score: number;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Deterministic local-only bitmap diagnostics. The score measures technical
 * readability (balanced light, contrast, color separation and complexity);
 * it is not a YouTube CTR prediction.
 */
export function analyzeThumbnailPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ThumbnailDiagnostics {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      edgeDensity: 0,
      score: 0,
    };
  }
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 24_000)));
  let count = 0;
  let luminanceTotal = 0;
  let luminanceSquared = 0;
  let saturationTotal = 0;
  let edges = 0;
  let edgeComparisons = 0;
  const luminanceAt = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return (
      (pixels[offset] ?? 0) * 0.2126 +
      (pixels[offset + 1] ?? 0) * 0.7152 +
      (pixels[offset + 2] ?? 0) * 0.0722
    );
  };
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      const luminance = luminanceAt(x, y);
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      luminanceTotal += luminance;
      luminanceSquared += luminance * luminance;
      saturationTotal += maximum > 0 ? (maximum - minimum) / maximum : 0;
      count += 1;
      if (x + step < width) {
        edges += Math.abs(luminance - luminanceAt(x + step, y)) > 38 ? 1 : 0;
        edgeComparisons += 1;
      }
      if (y + step < height) {
        edges += Math.abs(luminance - luminanceAt(x, y + step)) > 38 ? 1 : 0;
        edgeComparisons += 1;
      }
    }
  }
  const mean = count > 0 ? luminanceTotal / count : 0;
  const variance = count > 0 ? Math.max(0, luminanceSquared / count - mean * mean) : 0;
  const deviation = Math.sqrt(variance);
  const saturation = count > 0 ? saturationTotal / count : 0;
  const edgeDensity = edgeComparisons > 0 ? edges / edgeComparisons : 0;
  const brightnessScore = clamp(100 - Math.abs(mean - 132) * 0.9);
  const contrastScore = clamp((deviation / 58) * 100);
  const saturationScore = clamp(100 - Math.abs(saturation - 0.42) * 160);
  const complexityScore = clamp(100 - Math.abs(edgeDensity - 0.16) * 260);
  return {
    brightness: Math.round((mean / 255) * 100),
    contrast: Math.round(clamp((deviation / 80) * 100)),
    saturation: Math.round(saturation * 100),
    edgeDensity: Math.round(edgeDensity * 100),
    score: Math.round(
      brightnessScore * 0.25 +
        contrastScore * 0.35 +
        saturationScore * 0.2 +
        complexityScore * 0.2,
    ),
  };
}
