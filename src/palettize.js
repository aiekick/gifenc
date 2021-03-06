import {
  rgb888_to_rgb444,
  rgb888_to_rgb565,
  rgba8888_to_rgba4444,
} from "./rgb-packing";

const { euclideanDistanceSquared } = require("./color");

function roundStep(byte, step) {
  return step > 1 ? Math.round(byte / step) * step : byte;
}

export function prequantize(
  data,
  { roundRGB = 5, roundAlpha = 10, oneBitAlpha = null } = {}
) {
  for (let i = 0; i < data.length; i++) {
    const color = data[i];
    let a = (color >> 24) & 0xff;
    let b = (color >> 16) & 0xff;
    let g = (color >> 8) & 0xff;
    let r = color & 0xff;

    a = roundStep(a, roundAlpha);
    if (oneBitAlpha) {
      const threshold = typeof oneBitAlpha === "number" ? oneBitAlpha : 127;
      a = a <= threshold ? 0x00 : 0xff;
    }
    r = roundStep(r, roundRGB);
    g = roundStep(g, roundRGB);
    b = roundStep(b, roundRGB);

    data[i] = (a << 24) | (b << 16) | (g << 8) | (r << 0);
  }
}

export function applyPalette(data, palette, format) {
  format = format || "rgb565";

  const bincount = format === "rgb444" ? 4096 : 65536;
  const index = new Uint8Array(data.length);
  const cache = new Array(bincount);
  const hasAlpha = format === "rgba4444";

  // Some duplicate code below due to very hot code path
  // Introducing branching/conditions shows some significant impact
  if (format === "rgba4444") {
    for (let i = 0; i < data.length; i++) {
      const color = data[i];
      const a = (color >> 24) & 0xff;
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;
      const key = rgba8888_to_rgba4444(r, g, b, a);
      let idx;
      if (cache[key] != null) {
        idx = cache[key];
      } else {
        idx = nearestColorIndexRGBA(r, g, b, a, palette);
        cache[key] = idx;
      }
      index[i] = idx;
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      const color = data[i];
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;
      const key =
        format === "rgb444"
          ? rgb888_to_rgb444(r, g, b)
          : rgb888_to_rgb565(r, g, b);
      let idx;
      if (cache[key] != null) {
        idx = cache[key];
      } else {
        idx = nearestColorIndexRGB(r, g, b, palette);
        cache[key] = idx;
      }
      index[i] = idx;
    }
  }

  return index;
}

function to_key(r, g, b, a, format) {
  if (format === "rgba4444") return rgba8888_to_rgba4444(r, g, b, a);
  else if (format === "rgb444") return rgb888_to_rgb444(r, g, b);
  else return rgb888_to_rgb565(r, g, b);
}

function nearestColorIndexRGBA(r, g, b, a, palette) {
  let k = 0;
  let mindist = 1e100;
  for (let i = 0; i < palette.length; i++) {
    const px2 = palette[i];
    const r2 = px2[0];
    const g2 = px2[1];
    const b2 = px2[2];
    const a2 = px2[3];
    let curdist = sqr(a2 - a);
    if (curdist > mindist) continue;
    curdist += sqr(r2 - r);
    if (curdist > mindist) continue;
    curdist += sqr(g2 - g);
    if (curdist > mindist) continue;
    curdist += sqr(b2 - b);
    if (curdist > mindist) continue;
    mindist = curdist;
    k = i;
  }
  return k;
}

function nearestColorIndexRGB(r, g, b, palette) {
  let k = 0;
  let mindist = 1e100;
  for (let i = 0; i < palette.length; i++) {
    const px2 = palette[i];
    const r2 = px2[0];
    const g2 = px2[1];
    const b2 = px2[2];
    let curdist = sqr(r2 - r);
    if (curdist > mindist) continue;
    curdist += sqr(g2 - g);
    if (curdist > mindist) continue;
    curdist += sqr(b2 - b);
    if (curdist > mindist) continue;
    mindist = curdist;
    k = i;
  }
  return k;
}

export function colorSnap(palette, knownColors, threshold = 5) {
  if (!palette.length || !knownColors.length) return;

  const paletteRGB = palette.map((p) => p.slice(0, 3));
  const thresholdSq = threshold * threshold;
  const dim = palette[0].length;
  for (let i = 0; i < knownColors.length; i++) {
    let color = knownColors[i];
    if (color.length < dim) {
      // palette is RGBA, known is RGB
      color = [color[0], color[1], color[2], 0xff];
    } else if (color.length > dim) {
      // palette is RGB, known is RGBA
      color = color.slice(0, 3);
    } else {
      // make sure we always copy known colors
      color = color.slice();
    }
    const r = nearestColorIndexWithDistance(
      paletteRGB,
      color.slice(0, 3),
      euclideanDistanceSquared
    );
    const idx = r[0];
    const distanceSq = r[1];
    if (distanceSq > 0 && distanceSq <= thresholdSq) {
      palette[idx] = color;
    }
  }
}

function sqr(a) {
  return a * a;
}

export function nearestColorIndex(
  colors,
  pixel,
  distanceFn = euclideanDistanceSquared
) {
  let minDist = Infinity;
  let minDistIndex = -1;
  for (let j = 0; j < colors.length; j++) {
    const paletteColor = colors[j];
    const dist = distanceFn(pixel, paletteColor);
    if (dist < minDist) {
      minDist = dist;
      minDistIndex = j;
    }
  }
  return minDistIndex;
}

export function nearestColorIndexWithDistance(
  colors,
  pixel,
  distanceFn = euclideanDistanceSquared
) {
  let minDist = Infinity;
  let minDistIndex = -1;
  for (let j = 0; j < colors.length; j++) {
    const paletteColor = colors[j];
    const dist = distanceFn(pixel, paletteColor);
    if (dist < minDist) {
      minDist = dist;
      minDistIndex = j;
    }
  }
  return [minDistIndex, minDist];
}

export function nearestColor(
  colors,
  pixel,
  distanceFn = euclideanDistanceSquared
) {
  return colors[nearestColorIndex(colors, pixel, distanceFn)];
}
