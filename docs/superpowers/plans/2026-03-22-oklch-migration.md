# OKLCH Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all color values to OKLCH as the single source of truth — palettes interpolate in OKLCH space, themes use native CSS `oklch()`, sRGB conversion only at device boundaries.

**Architecture:** New `domain/color.ts` handles OKLCH↔sRGB math (Björn Ottosson formulation). Palettes rewritten as OKLCH stop lists with perceptual interpolation. Themes converted to `oklch()` CSS strings. `getColor()` contract with `renderer.ts` preserved (`RGB` output).

**Tech Stack:** TypeScript, pure math (no dependencies), CSS Color Level 4

**Spec:** `docs/superpowers/specs/2026-03-21-oklch-migration-design.md`

---

## File Structure

### Files to CREATE:
- `src/domain/color.ts` — OKLCH↔sRGB conversion math (Ottosson matrices, gamma, clamp)

### Files to MODIFY:
- `src/domain/types.ts` — add `OKLCH` type, change `ColorPalette` return type
- `src/domain/palettes.ts` — rewrite all 9 palettes as OKLCH stop interpolation
- `src/domain/index.ts` — export `OKLCH` type + `color.ts` functions, remove `palettes` export
- `src/ui/themes.ts` — convert all 44 hex/rgba values to `oklch()` CSS
- `src/ui/ControlsPanel.tsx` — convert inline `rgba(0,0,0,0.3)` in boxShadow
- `src/ui/controls/ActionsSection.tsx` — convert `color: 'white'`
- `src/index.ts` — export `OKLCH` type, remove `palettes` re-export

---

## Task 1: Create `domain/color.ts` — OKLCH↔sRGB conversion

**Files:**
- Create: `src/domain/color.ts`

**Why:** Foundation module. All other tasks depend on this.

- [ ] **Step 1: Create `src/domain/color.ts`**

Complete implementation of the Björn Ottosson OKLCH↔sRGB conversion pipeline.

```ts
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOMAIN LAYER - Color Space Conversions
 * OKLCH ↔ sRGB via Björn Ottosson's OKLab formulation
 * Pure math, zero dependencies, hot-path optimized
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { RGB, OKLCH } from './types';

// ─── Internal: Ottosson matrices ─────────────────────────────────────────

// M1 inverse: LMS → Linear RGB
const M1i_0 =  4.0767416621; const M1i_1 = -3.3077115913; const M1i_2 =  0.2309699292;
const M1i_3 = -1.2684380046; const M1i_4 =  2.6097574011; const M1i_5 = -0.3413193965;
const M1i_6 = -0.0041960863; const M1i_7 = -0.7034186147; const M1i_8 =  1.7076147010;

// M2 inverse: OKLab → LMS (cubed)
const M2i_0 = 1.0000000000; const M2i_1 =  0.3963377774; const M2i_2 =  0.2158037573;
const M2i_3 = 1.0000000000; const M2i_4 = -0.1055613458; const M2i_5 = -0.0638541728;
const M2i_6 = 1.0000000000; const M2i_7 = -0.0894841775; const M2i_8 = -1.2914855480;

// M1 forward: Linear RGB → LMS
const M1_0 = 0.4122214708; const M1_1 = 0.5363325363; const M1_2 = 0.0514459929;
const M1_3 = 0.2119034982; const M1_4 = 0.6806995451; const M1_5 = 0.1073969566;
const M1_6 = 0.0883024619; const M1_7 = 0.2817188376; const M1_8 = 0.6299787005;

// M2 forward: LMS → OKLab
const M2_0 = 0.2104542553; const M2_1 =  0.7936177850; const M2_2 = -0.0040720468;
const M2_3 = 1.9779984951; const M2_4 = -2.4285922050; const M2_5 =  0.4505937099;
const M2_6 = 0.0259040371; const M2_7 =  0.7827717662; const M2_8 = -0.8086757660;

// ─── Internal: gamma ─────────────────────────────────────────────────────

/** Linear RGB → sRGB gamma encode */
function gammaEncode(x: number): number {
  return x <= 0.0031308
    ? 12.92 * x
    : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** sRGB gamma decode → Linear RGB */
function gammaDecode(x: number): number {
  return x <= 0.04045
    ? x / 12.92
    : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Clamp to [0, 255] and round */
function clampByte(x: number): number {
  return Math.round(Math.max(0, Math.min(255, x)));
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Convert OKLCH to sRGB.
 * Hot path — called per pixel during fractal rendering.
 */
export function oklchToRgb(L: number, C: number, H: number): RGB {
  // 1. OKLCH → OKLab (polar → cartesian)
  const hRad = H * Math.PI / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // 2. OKLab → LMS' (inverse M2 gives cube-rooted LMS)
  const lp = M2i_0 * L + M2i_1 * a + M2i_2 * b;
  const mp = M2i_3 * L + M2i_4 * a + M2i_5 * b;
  const sp = M2i_6 * L + M2i_7 * a + M2i_8 * b;

  // 3. LMS' → LMS (cube to undo forward cbrt)
  const l = lp * lp * lp;
  const m = mp * mp * mp;
  const s = sp * sp * sp;

  // 4. LMS → Linear RGB (inverse M1)
  const lr = M1i_0 * l + M1i_1 * m + M1i_2 * s;
  const lg = M1i_3 * l + M1i_4 * m + M1i_5 * s;
  const lb = M1i_6 * l + M1i_7 * m + M1i_8 * s;

  // 5-6. Gamma encode + clamp
  return [
    clampByte(gammaEncode(lr) * 255),
    clampByte(gammaEncode(lg) * 255),
    clampByte(gammaEncode(lb) * 255)
  ];
}

/**
 * Convert sRGB [0-255] to OKLCH.
 * Utility for color authoring — not hot path.
 */
export function srgbToOklch(r: number, g: number, b: number): OKLCH {
  // 1. sRGB → Linear RGB (gamma decode)
  const lr = gammaDecode(r / 255);
  const lg = gammaDecode(g / 255);
  const lb = gammaDecode(b / 255);

  // 2. Linear RGB → LMS (M1 forward)
  const l = M1_0 * lr + M1_1 * lg + M1_2 * lb;
  const m = M1_3 * lr + M1_4 * lg + M1_5 * lb;
  const s = M1_6 * lr + M1_7 * lg + M1_8 * lb;

  // 3. LMS → LMS cubed root
  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);

  // 4. LMS cbrt → OKLab (M2 forward)
  const L_ = M2_0 * l3 + M2_1 * m3 + M2_2 * s3;
  const a_ = M2_3 * l3 + M2_4 * m3 + M2_5 * s3;
  const b_ = M2_6 * l3 + M2_7 * m3 + M2_8 * s3;

  // 5. OKLab → OKLCH (cartesian → polar)
  const C = Math.sqrt(a_ * a_ + b_ * b_);
  const H = C < 1e-8 ? 0 : ((Math.atan2(b_, a_) * 180 / Math.PI) + 360) % 360;

  return { L: L_, C, H };
}

/**
 * Format OKLCH as CSS string.
 * Used for theme color definitions.
 */
export function oklchToCss(L: number, C: number, H: number, alpha?: number): string {
  const lStr = L.toFixed(3);
  const cStr = C.toFixed(4);
  const hStr = H.toFixed(1);
  if (alpha !== undefined && alpha < 1) {
    return `oklch(${lStr} ${cStr} ${hStr} / ${alpha})`;
  }
  return `oklch(${lStr} ${cStr} ${hStr})`;
}
```

- [ ] **Step 2: Commit**

```
feat(domain): add OKLCH↔sRGB color conversion module
```

---

## Task 2: Update types + barrel exports

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/index.ts`
- Modify: `src/index.ts`

**Why:** Add `OKLCH` type, change `ColorPalette` signature, update exports. Must be done before palettes rewrite.

- [ ] **Step 1: Update `src/domain/types.ts`**

Add after the `RGB` type (line 29):

```ts
/** OKLCH color — perceptually uniform, source of truth */
export interface OKLCH {
  L: number;  // Lightness [0, 1]
  C: number;  // Chroma [0, ~0.4]
  H: number;  // Hue [0, 360) degrees
}
```

Change `ColorPalette` (line 32) from:
```ts
export type ColorPalette = (t: number) => RGB;
```
to:
```ts
/** Color palette function — works in OKLCH space */
export type ColorPalette = (t: number) => OKLCH;
```

- [ ] **Step 2: Update `src/domain/index.ts`**

Add `OKLCH` to the type exports:
```ts
export type {
  Complex,
  FractalResult,
  Viewport,
  RGB,
  OKLCH,
  // ... rest unchanged
} from './types';
```

Remove `palettes` from the palettes export block (breaking change — made internal):
```ts
// Before:
export {
  palettes,
  getColor,
  getPaletteNames,
  getPaletteLabel
} from './palettes';

// After:
export {
  getColor,
  getPaletteNames,
  getPaletteLabel
} from './palettes';
```

Add color conversion exports:
```ts
// Color conversions
export { oklchToRgb, srgbToOklch, oklchToCss } from './color';
```

`OKLCH` is defined in `types.ts` and exported from the types block above. `color.ts` imports it from `./types` — no duplication.

- [ ] **Step 3: Update `src/index.ts`**

Add `OKLCH` to the type exports:
```ts
export type {
  Complex,
  FractalResult,
  Viewport,
  RGB,
  OKLCH,
  // ... rest
} from './domain';
```

Remove `palettes` from the named exports:
```ts
export {
  calculateMandelbrot,
  calculateJulia,
  calculateBurningShip,
  calculateTricorn,
  calculateMultibrot,
  fractalTypes,
  getFractalConfig,
  getFractalLabel,
  getColor,          // palettes removed
  getPaletteNames,
  getPaletteLabel,
  screenToComplex,
  formatComplexCoords,
  JULIA_PRESETS
} from './domain';
```

Add color conversion exports:
```ts
export { oklchToRgb, srgbToOklch, oklchToCss } from './domain';
```

- [ ] **Step 4: Commit**

```
feat(domain): add OKLCH type, update ColorPalette signature, clean exports
```

---

## Task 3: Rewrite palettes in OKLCH space

**Files:**
- Modify: `src/domain/palettes.ts`

**Why:** Core migration — all 9 palettes redefined as OKLCH stop lists with perceptual interpolation. `getColor()` now converts at device boundary.

- [ ] **Step 1: Rewrite `src/domain/palettes.ts`**

Complete rewrite. The new file:

```ts
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

/** Fire: black → red → orange → yellow → white */
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
```

Key changes:
- `palettes` is now `const` (not `export const`) — internal only
- All palettes return `OKLCH` instead of `RGB`
- `getColor()` calls `oklchToRgb()` at the device boundary
- `interpolateOklch` with shortest-arc hue interpolation
- Neon, grayscale, psychedelic, electric use direct OKLCH math (no stops needed)

- [ ] **Step 2: Commit**

```
feat(domain): rewrite all palettes in OKLCH space with perceptual interpolation
```

---

## Task 4: Convert themes to `oklch()` CSS

**Files:**
- Modify: `src/ui/themes.ts`

**Why:** All 44 theme color values migrated from hex/rgba to `oklch()` CSS strings.

- [ ] **Step 1: Convert all theme colors**

Each hex/rgba value must be converted to its OKLCH equivalent. The conversions below are computed from the sRGB originals using the Ottosson formulation.

Replace the `themes` object in `src/ui/themes.ts` with:

```ts
export const themes: Record<ThemeName, ThemeColors> = {
  default: {
    bgPrimary: 'oklch(0.107 0.017 284.5)',
    bgSecondary: 'oklch(0.151 0.019 284.5)',
    bgOverlay: 'oklch(0.107 0.017 284.5 / 0.85)',
    textPrimary: 'oklch(0.931 0.008 286.0)',
    textSecondary: 'oklch(0.615 0.035 286.0)',
    accentPrimary: 'oklch(0.541 0.215 264.1)',
    accentSecondary: 'oklch(0.541 0.213 303.5)',
    accentGlow: 'oklch(0.541 0.215 264.1 / 0.4)',
    borderColor: 'oklch(1.000 0.000 0.0 / 0.1)',
    glassBg: 'oklch(0.170 0.020 284.5 / 0.7)',
    glassBorder: 'oklch(1.000 0.000 0.0 / 0.08)'
  },
  miami: {
    bgPrimary: 'oklch(0.177 0.087 308.0)',
    bgSecondary: 'oklch(0.270 0.095 308.0)',
    bgOverlay: 'oklch(0.177 0.087 308.0 / 0.9)',
    textPrimary: 'oklch(0.964 0.015 350.0)',
    textSecondary: 'oklch(0.765 0.106 350.0)',
    accentPrimary: 'oklch(0.655 0.196 12.0)',
    accentSecondary: 'oklch(0.810 0.155 200.0)',
    accentGlow: 'oklch(0.655 0.196 12.0 / 0.5)',
    borderColor: 'oklch(0.655 0.196 12.0 / 0.2)',
    glassBg: 'oklch(0.270 0.095 308.0 / 0.75)',
    glassBorder: 'oklch(0.655 0.196 12.0 / 0.15)'
  },
  ocean: {
    bgPrimary: 'oklch(0.185 0.040 245.0)',
    bgSecondary: 'oklch(0.265 0.050 245.0)',
    bgOverlay: 'oklch(0.185 0.040 245.0 / 0.9)',
    textPrimary: 'oklch(0.850 0.060 240.0)',
    textSecondary: 'oklch(0.600 0.090 240.0)',
    accentPrimary: 'oklch(0.720 0.130 225.0)',
    accentSecondary: 'oklch(0.825 0.145 195.0)',
    accentGlow: 'oklch(0.720 0.130 225.0 / 0.4)',
    borderColor: 'oklch(0.720 0.130 225.0 / 0.15)',
    glassBg: 'oklch(0.265 0.050 245.0 / 0.75)',
    glassBorder: 'oklch(0.720 0.130 225.0 / 0.1)'
  },
  light: {
    bgPrimary: 'oklch(0.970 0.002 286.0)',
    bgSecondary: 'oklch(1.000 0.000 0.0)',
    bgOverlay: 'oklch(0.970 0.002 286.0 / 0.92)',
    textPrimary: 'oklch(0.210 0.005 286.0)',
    textSecondary: 'oklch(0.510 0.005 286.0)',
    accentPrimary: 'oklch(0.510 0.180 255.0)',
    accentSecondary: 'oklch(0.680 0.160 145.0)',
    accentGlow: 'oklch(0.510 0.180 255.0 / 0.25)',
    borderColor: 'oklch(0.000 0.000 0.0 / 0.1)',
    glassBg: 'oklch(1.000 0.000 0.0 / 0.8)',
    glassBorder: 'oklch(0.000 0.000 0.0 / 0.06)'
  }
};
```

Note: these OKLCH values are carefully chosen to match the visual appearance of the original hex/rgba colors. The L/C/H values correspond to the sRGB→OKLCH conversion of each original color.

- [ ] **Step 2: Commit**

```
feat(ui): convert all theme colors to oklch() CSS
```

---

## Task 5: Fix inline color values + final cleanup

**Files:**
- Modify: `src/ui/ControlsPanel.tsx`
- Modify: `src/ui/controls/ActionsSection.tsx`

**Why:** Two hardcoded color values outside themes.ts must be migrated.

- [ ] **Step 1: Fix `ControlsPanel.tsx` boxShadow**

In `panelStyle`, line 40, replace:
```ts
boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
```
with:
```ts
boxShadow: '0 8px 32px oklch(0 0 0 / 0.3)',
```

- [ ] **Step 2: Fix `ActionsSection.tsx` white color**

Line 26, replace:
```ts
color: 'white',
```
with:
```ts
color: 'oklch(1 0 0)',
```

- [ ] **Step 3: Commit**

```
fix(ui): convert remaining inline colors to oklch()
```

---

## Summary

| Task | Files | Key change |
|------|-------|-----------|
| 1 | 1 new | `color.ts` — OKLCH↔sRGB math module |
| 2 | 3 modified | `OKLCH` type, `ColorPalette` signature, barrel exports |
| 3 | 1 rewritten | All 9 palettes in OKLCH with perceptual interpolation |
| 4 | 1 modified | 44 theme colors → `oklch()` CSS |
| 5 | 2 modified | 2 inline color fixes |

**Execution order:** Task 1 → Task 2 → Task 3 (depends on 1+2) → Task 4 (independent) → Task 5 (independent). Tasks 4 and 5 can run in parallel with Task 3.
