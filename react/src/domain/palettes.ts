/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Color Palettes
 * OKLCH-based palettes with perceptually uniform interpolation
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { RGB, OKLCH, ColorPalette, PaletteName, FractalResult } from './types';
import { oklchToRgb } from './color';

// ─── Interpolation engine ────────────────────────────────────────────────

interface OklchStop {
  pos: number;  // position in [0, 1]
  L: number;
  C: number;
  H: number;
}

/**
 * Interpolate between OKLCH stops.
 * Hue uses shortest-arc interpolation.
 */
function interpolateOklch(stops: OklchStop[], t: number): OKLCH {
  // Clamp
  if (t <= stops[0].pos) return { L: stops[0].L, C: stops[0].C, H: stops[0].H };
  const last = stops[stops.length - 1];
  if (t >= last.pos) return { L: last.L, C: last.C, H: last.H };

  // Find enclosing stops
  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].pos < t) i++;
  const a = stops[i];
  const b = stops[i + 1];

  // Normalized position between the two stops
  const f = (t - a.pos) / (b.pos - a.pos);

  // Hue: shortest arc
  let dh = b.H - a.H;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;

  return {
    L: a.L + (b.L - a.L) * f,
    C: a.C + (b.C - a.C) * f,
    H: ((a.H + dh * f) + 360) % 360
  };
}

/** Create a palette from OKLCH stops */
function fromStops(stops: OklchStop[]): ColorPalette {
  return (t) => interpolateOklch(stops, t);
}

// ─── Palette definitions ─────────────────────────────────────────────────

/** Classic: dark blue → teal → gold → dark (Bernstein-inspired curve) */
const classicPalette = fromStops([
  { pos: 0.0,  L: 0.05, C: 0.05, H: 265 },  // near-black blue
  { pos: 0.15, L: 0.30, C: 0.12, H: 265 },  // deep blue
  { pos: 0.33, L: 0.50, C: 0.14, H: 220 },  // blue
  { pos: 0.50, L: 0.65, C: 0.15, H: 180 },  // teal
  { pos: 0.67, L: 0.75, C: 0.15, H: 90  },  // green-gold
  { pos: 0.85, L: 0.80, C: 0.16, H: 70  },  // gold
  { pos: 1.0,  L: 0.10, C: 0.05, H: 50  },  // dark
]);

/** Fire: black → red → orange → yellow → white
 * @tradeoff pos=0.50 (C=0.20, H=40, L=0.60) produces Linear RGB blue ≈ -0.009,
 * marginally out of sRGB gamut. Clamp corrects it; visual impact < 0.01.
 * Reducing C to 0.19 would fix it but dulls the orange. */
const firePalette = fromStops([
  { pos: 0.0,  L: 0.00, C: 0.00, H: 30  },  // black
  { pos: 0.25, L: 0.40, C: 0.18, H: 30  },  // dark red
  { pos: 0.50, L: 0.60, C: 0.20, H: 40  },  // orange-red
  { pos: 0.75, L: 0.85, C: 0.18, H: 90  },  // yellow
  { pos: 1.0,  L: 1.00, C: 0.00, H: 90  },  // white
]);

/** Ice: cool blues, low chroma */
const icePalette = fromStops([
  { pos: 0.0,  L: 0.30, C: 0.02, H: 250 },  // dark blue-grey
  { pos: 0.33, L: 0.55, C: 0.08, H: 245 },  // medium blue
  { pos: 0.67, L: 0.75, C: 0.10, H: 230 },  // light blue
  { pos: 1.0,  L: 0.92, C: 0.05, H: 240 },  // ice white-blue
]);

/** Neon: full hue rotation, high chroma */
const neonPalette: ColorPalette = (t) => ({
  L: 0.65,
  C: 0.18,
  H: (t * 360) % 360
});

/** Grayscale: achromatic L ramp */
const grayscalePalette: ColorPalette = (t) => ({
  L: t,
  C: 0,
  H: 0
});

/** Psychedelic: rapid hue cycling, high chroma */
const psychedelicPalette: ColorPalette = (t) => ({
  L: 0.65 + Math.sin(t * 10) * 0.10,
  C: 0.15,
  H: (t * 360 * 3) % 360
});

/** Sunset: warm orange → cool purple */
const sunsetPalette = fromStops([
  { pos: 0.0,  L: 0.65, C: 0.18, H: 50  },  // warm orange
  { pos: 0.25, L: 0.70, C: 0.16, H: 40  },  // gold
  { pos: 0.50, L: 0.60, C: 0.15, H: 15  },  // salmon
  { pos: 0.75, L: 0.45, C: 0.14, H: 330 },  // magenta
  { pos: 1.0,  L: 0.35, C: 0.12, H: 290 },  // purple
]);

/** Miami: neon pink → cyan → purple */
const miamiPalette = fromStops([
  { pos: 0.0,  L: 0.65, C: 0.20, H: 350 },  // pink
  { pos: 0.17, L: 0.75, C: 0.17, H: 60  },  // warm yellow (force long arc through warm)
  { pos: 0.33, L: 0.80, C: 0.14, H: 200 },  // cyan
  { pos: 0.67, L: 0.55, C: 0.20, H: 300 },  // purple
  { pos: 1.0,  L: 0.65, C: 0.20, H: 350 },  // pink (loop)
]);

/** Electric: double hue rotation, high chroma, high lightness */
const electricPalette: ColorPalette = (t) => ({
  L: 0.75 - t * 0.15,
  C: 0.16,
  H: (t * 720) % 360
});

// ─── Registry ────────────────────────────────────────────────────────────

/** All palettes — internal, not exported via barrel */
const palettes: Record<PaletteName, ColorPalette> = {
  classic: classicPalette,
  fire: firePalette,
  ice: icePalette,
  neon: neonPalette,
  grayscale: grayscalePalette,
  psychedelic: psychedelicPalette,
  sunset: sunsetPalette,
  miami: miamiPalette,
  electric: electricPalette
};

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Get color for a fractal calculation result.
 * Palette works in OKLCH, conversion to sRGB at device boundary.
 */
export function getColor(
  result: FractalResult,
  paletteName: PaletteName
): RGB {
  if (!result.escaped) {
    return [0, 0, 0];
  }

  const palette = palettes[paletteName] ?? palettes.classic;
  const t = (result.smoothValue % 256) / 256;
  const oklch = palette(t);
  return oklchToRgb(oklch.L, oklch.C, oklch.H);
}

/**
 * Get all palette names
 */
export function getPaletteNames(): PaletteName[] {
  return Object.keys(palettes) as PaletteName[];
}

/**
 * Get human-readable label for a palette
 */
export function getPaletteLabel(name: PaletteName): string {
  const labels: Record<PaletteName, string> = {
    classic: 'Classique',
    fire: 'Feu',
    ice: 'Glace',
    neon: 'Néon',
    grayscale: 'Niveaux de gris',
    psychedelic: 'Psychédélique',
    sunset: 'Coucher de soleil',
    miami: 'Miami',
    electric: 'Électrique'
  };
  return labels[name] ?? name;
}
