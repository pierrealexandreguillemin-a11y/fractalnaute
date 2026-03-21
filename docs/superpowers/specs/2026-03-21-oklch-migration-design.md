# OKLCH Migration Design Spec

**Goal:** Migrate all color values in fractal-explorer to OKLCH as the single source of truth. sRGB conversion only at device boundaries (ImageData pixels, CSS fallback).

**Standard:** CSS Color Level 4, perceptually uniform color space.

## Architecture

### New file: `domain/color.ts`

Pure math module, zero dependencies. Hot path critical.

**Public API:**
- `oklchToRgb(L, C, H): RGB` — conversion + sRGB clamp, called per-pixel
- `srgbToOklch(r, g, b): OKLCH` — utility for color authoring
- `oklchToCss(L, C, H, alpha?): string` — `"oklch(0.55 0.23 264)"` or `"oklch(0.55 0.23 264 / 0.7)"`

**Internal pipeline:** OKLCH → OKLab (polar→cartesian) → Linear RGB (3x3 matrix via LMS) → sRGB (gamma) → clamp [0,255]

**Gamut strategy:** Clamp at sRGB boundary. Palettes designed with C ≤ 0.2 to stay in gamut. Themes use native CSS `oklch()` — browser handles gamut mapping per spec.

### Modified: `domain/types.ts`

```ts
/** OKLCH color — perceptually uniform, source of truth */
export type OKLCH = { L: number; C: number; H: number };

/** Color palette function — works in OKLCH space */
export type ColorPalette = (t: number) => OKLCH;
```

`RGB` type kept — used at device boundary only.

### Rewritten: `domain/palettes.ts`

Each palette defined as OKLCH stops + interpolation:

```ts
type OklchStop = { L: number; C: number; H: number; pos: number };
```

`interpolateOklch(stops, t)` finds enclosing stops, lerps L/C/H, returns `OKLCH`. Hue interpolation uses shortest arc.

9 palettes rewritten with OKLCH stops matching their current visual character:
- **classic** — Bernstein curve equivalent: dark blue → teal → gold → dark
- **fire** — black L=0 → red → yellow → white L=1
- **ice** — cool blues, low chroma, high lightness range
- **neon** — full hue rotation, high chroma, medium lightness
- **grayscale** — C=0, L ramps 0→1
- **psychedelic** — rapid hue cycling (high frequency), high chroma
- **sunset** — warm orange → cool purple, medium chroma
- **miami** — pink/cyan/purple stops, high chroma
- **electric** — double hue rotation, high chroma, high lightness

### Modified: `domain/palettes.ts` — `getColor()`

```ts
getColor(result, paletteName): RGB {
  if (!result.escaped) return [0, 0, 0];
  const palette = palettes[paletteName] ?? palettes.classic;
  const t = (result.smoothValue % 256) / 256;
  const oklch = palette(t);
  return oklchToRgb(oklch.L, oklch.C, oklch.H);  // sRGB at device boundary
}
```

Return type stays `RGB` — contract with `renderer.ts` unchanged.

### Rewritten: `ui/themes.ts`

All 44 color values converted from hex/rgba to `oklch()` CSS strings. Conversion done at authoring time (hardcoded OKLCH values), no runtime conversion.

Example:
```ts
// Before:
bgPrimary: '#0a0a0f',
accentGlow: 'rgba(99, 102, 241, 0.4)',

// After:
bgPrimary: 'oklch(0.11 0.02 280)',
accentGlow: 'oklch(0.55 0.22 264 / 0.4)',
```

`ThemeColors` interface unchanged (still `string` values).

## What does NOT change

- `renderer.ts` — still receives `RGB` from `getColor()`, writes to `ImageData`
- `infrastructure/` layer — no changes
- `application/` layer — no changes
- UI components — consume CSS custom properties as before
- `getColor()` signature — still `(result, paletteName): RGB`

## Data flow

```
Palettes:  OKLCH stops → interpolate OKLCH → oklchToRgb() → RGB → ImageData
Themes:    OKLCH literals → CSS oklch() strings → browser gamut mapping → display
```

## Performance

`oklchToRgb` is the hot path (~8M calls per render). Operations: 2 trig (cos/sin for polar→cartesian), 2 matrix multiplies (3x3), 3 gamma corrections (pow), 3 clamps. Estimated ~30-50ns per call, comparable to current palette math.

## Browser support

`oklch()` CSS: Chrome 111+, Firefox 113+, Safari 15.4+. Baseline widely available since 2023.
