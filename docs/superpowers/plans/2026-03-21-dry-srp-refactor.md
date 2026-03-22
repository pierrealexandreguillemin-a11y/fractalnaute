# DRY/SRP Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all DRY violations and fix SRP issues in `fractal-explorer/react/src/` to make the codebase clean for upcoming perf optimizations.

**Architecture:** Structural refactoring only — no behavior changes. Extract shared styles into `themes.ts`, split monolithic components into focused files, centralize Julia defaults, move utility functions to their proper domain/infrastructure homes. Every import chain stays within the established layer boundaries (UI -> Application -> Domain, Infrastructure -> Domain).

**Tech Stack:** React 18, TypeScript, CSS-in-JS (inline styles with CSS custom properties)

**Context:** No package.json, no test runner, no build tooling in this repo. This is a standalone React component library. Verification is done via TypeScript type-checking (if available) and manual review of import chains.

---

## File Structure (Target)

### Files to CREATE:
- `src/ui/styles.ts` — shared UI style constants (glassPanel, divider, etc.)
- `src/ui/InfoPanel.tsx` — extracted from `components.tsx`
- `src/ui/HelpTooltip.tsx` — extracted from `components.tsx`
- `src/ui/LoadingOverlay.tsx` — extracted from `components.tsx`
- `src/ui/Kbd.tsx` — extracted from `components.tsx` (used by HelpTooltip)
- `src/ui/controls/FractalTypeSection.tsx` — extracted from ControlsPanel
- `src/ui/controls/JuliaSection.tsx` — extracted from ControlsPanel
- `src/ui/controls/AppearanceSection.tsx` — extracted from ControlsPanel (theme + palette + iterations)
- `src/ui/controls/ActionsSection.tsx` — extracted from ControlsPanel
- `src/infrastructure/canvasUtils.ts` — extracted from `renderer.ts`

### Files to MODIFY:
- `src/ui/themes.ts` — add `getThemeNames()`, export `glassBaseStyle`
- `src/ui/ControlsPanel.tsx` — rewrite as thin assembler of sub-sections
- `src/ui/index.ts` — update barrel exports
- `src/domain/fractals.ts:48-49` — use `DEFAULT_JULIA_PARAMS` instead of magic numbers
- `src/domain/coordinates.ts` — add `formatComplexCoords()`
- `src/domain/index.ts` — export new function
- `src/infrastructure/renderer.ts` — remove `resizeCanvas`, `exportCanvas`, `downloadCanvas`
- `src/infrastructure/useRenderer.ts` — import from `canvasUtils`
- `src/infrastructure/index.ts` — update barrel
- `src/application/useFractalState.ts` — accept initial config param
- `src/FractalExplorer.tsx` — remove init useEffect, pass config to hook

### Files to DELETE:
- `src/ui/components.tsx` — replaced by individual component files

---

## Task 1: Split `components.tsx` into individual files

**Files:**
- Create: `src/ui/InfoPanel.tsx`
- Create: `src/ui/HelpTooltip.tsx`
- Create: `src/ui/Kbd.tsx`
- Create: `src/ui/LoadingOverlay.tsx`
- Delete: `src/ui/components.tsx`
- Modify: `src/ui/index.ts`

**Why:** `components.tsx` bundles 3 unrelated components (InfoPanel, HelpTooltip, LoadingOverlay) + a helper (Kbd). SRP violation — each should be its own file.

- [ ] **Step 1: Create `src/ui/Kbd.tsx`**

Extract the `Kbd` component (currently `components.tsx:63-77`). It's a dependency of HelpTooltip, so extract first.

```tsx
import React from 'react';

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      display: 'inline-block',
      padding: '2px 6px',
      background: 'var(--fractal-bg-secondary)',
      border: '1px solid var(--fractal-border-color)',
      borderRadius: '4px',
      fontFamily: 'inherit',
      fontSize: '10px'
    }}
  >
    {children}
  </span>
);
```

- [ ] **Step 2: Create `src/ui/InfoPanel.tsx`**

Extract `InfoPanel` (currently `components.tsx:14-57`). Keep the inline glass styles for now — Task 2 will DRY them.

```tsx
import React from 'react';
import type { RenderStats } from '../domain';

interface InfoPanelProps {
  stats: RenderStats;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({ stats }) => (
  <div
    style={{
      position: 'absolute',
      bottom: '16px',
      left: '16px',
      background: 'var(--fractal-glass-bg)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid var(--fractal-glass-border)',
      borderRadius: '12px',
      padding: '8px 16px',
      fontSize: '11px',
      fontFamily: "'SF Mono', 'Fira Code', monospace",
      color: 'var(--fractal-text-secondary)',
      zIndex: 10
    }}
  >
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        <span>Type:</span>
        <span style={{ color: 'var(--fractal-accent-primary)', fontWeight: 500 }}>
          {stats.fractalName}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <span>Zoom:</span>
        <span style={{ color: 'var(--fractal-accent-primary)', fontWeight: 500 }}>
          {stats.zoomLevel.toFixed(2)}x
        </span>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <span>Centre:</span>
        <span style={{ color: 'var(--fractal-accent-primary)', fontWeight: 500 }}>
          ({stats.centerRe.toFixed(4)}, {stats.centerIm.toFixed(4)})
        </span>
      </div>
    </div>
  </div>
);
```

- [ ] **Step 3: Create `src/ui/HelpTooltip.tsx`**

Extract `HelpTooltip` (currently `components.tsx:79-105`). Import `Kbd` from its new file.

```tsx
import React from 'react';
import { Kbd } from './Kbd';

export const HelpTooltip: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      bottom: '16px',
      right: '16px',
      background: 'var(--fractal-glass-bg)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid var(--fractal-glass-border)',
      borderRadius: '12px',
      padding: '8px 16px',
      fontSize: '11px',
      color: 'var(--fractal-text-secondary)',
      opacity: 0.7,
      transition: 'opacity 150ms ease',
      zIndex: 10
    }}
    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
  >
    <Kbd>Molette</Kbd> Zoom &nbsp;|&nbsp;
    <Kbd>Clic</Kbd> Centrer &nbsp;|&nbsp;
    <Kbd>Glisser</Kbd> Déplacer &nbsp;|&nbsp;
    <Kbd>R</Kbd> Reset
  </div>
);
```

- [ ] **Step 4: Create `src/ui/LoadingOverlay.tsx`**

Extract `LoadingOverlay` (currently `components.tsx:111-141`).

```tsx
import React from 'react';

interface LoadingOverlayProps {
  isVisible: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isVisible }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: 'var(--fractal-bg-overlay)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: isVisible ? 1 : 0,
      pointerEvents: isVisible ? 'auto' : 'none',
      transition: 'opacity 300ms ease',
      zIndex: 50
    }}
  >
    <div
      style={{
        width: '48px',
        height: '48px',
        border: '3px solid var(--fractal-border-color)',
        borderTopColor: 'var(--fractal-accent-primary)',
        borderRadius: '50%',
        animation: 'fractal-spin 0.8s linear infinite'
      }}
    />
  </div>
);
```

- [ ] **Step 5: Delete `src/ui/components.tsx`**

- [ ] **Step 6: Update `src/ui/index.ts`**

Replace the old `components` barrel import with individual file imports.

```ts
export { ControlsPanel } from './ControlsPanel';
export { InfoPanel } from './InfoPanel';
export { HelpTooltip } from './HelpTooltip';
export { LoadingOverlay } from './LoadingOverlay';
export { Kbd } from './Kbd';

export {
  themes,
  getThemeCSSVariables,
  getThemeLabel,
  keyframesCSS
} from './themes';

export type { ThemeColors } from './themes';
```

- [ ] **Step 7: Verify imports compile**

All consumers of the old `components.tsx` exports (`FractalExplorer.tsx:28`) import via the barrel `./ui`, so no other files need changes.

- [ ] **Step 8: Commit**

```
refactor(ui): split components.tsx into individual files
```

---

## Task 2: Extract shared glass style + `getThemeNames()`

**Files:**
- Create: `src/ui/styles.ts`
- Modify: `src/ui/themes.ts` — add `getThemeNames()`
- Modify: `src/ui/InfoPanel.tsx` — use `glassBaseStyle`
- Modify: `src/ui/HelpTooltip.tsx` — use `glassBaseStyle`
- Modify: `src/ui/ControlsPanel.tsx:37-53` — use `glassBaseStyle`, replace `themeOptions`
- Modify: `src/ui/index.ts` — export new symbols

**Why:** Glass panel styles are duplicated 3x (ControlsPanel, InfoPanel, HelpTooltip) + partially in the collapsed button. `themeOptions` is a hardcoded array that duplicates what `themes` already knows.

- [ ] **Step 1: Create `src/ui/styles.ts`**

Shared style constants for all UI components.

```ts
import React from 'react';

/** Base glassmorphism styles shared by all overlay panels */
export const glassBaseStyle: React.CSSProperties = {
  background: 'var(--fractal-glass-bg)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid var(--fractal-glass-border)',
  borderRadius: '12px',
  zIndex: 10
};

/** Horizontal divider between panel sections */
export const dividerStyle: React.CSSProperties = {
  height: '1px',
  background: 'var(--fractal-border-color)',
  margin: '12px 0'
};

/** Uppercase label style for form sections */
export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.3px',
  textTransform: 'uppercase',
  color: 'var(--fractal-text-secondary)',
  marginBottom: '4px'
};

/** Standard select input style */
export const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--fractal-bg-secondary)',
  border: '1px solid var(--fractal-border-color)',
  borderRadius: '8px',
  color: 'var(--fractal-text-primary)',
  fontSize: '13px',
  outline: 'none',
  cursor: 'pointer'
};
```

- [ ] **Step 2: Add `getThemeNames()` to `src/ui/themes.ts`**

Add after `getThemeLabel()` (line 103):

```ts
export function getThemeNames(): ThemeName[] {
  return Object.keys(themes) as ThemeName[];
}
```

- [ ] **Step 3: Update `InfoPanel.tsx` to use `glassBaseStyle`**

Replace the inline glass styles with spread:

```tsx
import { glassBaseStyle } from './styles';

// In the component:
<div
  style={{
    ...glassBaseStyle,
    position: 'absolute',
    bottom: '16px',
    left: '16px',
    padding: '8px 16px',
    fontSize: '11px',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    color: 'var(--fractal-text-secondary)',
  }}
>
```

- [ ] **Step 4: Update `HelpTooltip.tsx` to use `glassBaseStyle`**

```tsx
import { glassBaseStyle } from './styles';

// In the component:
<div
  style={{
    ...glassBaseStyle,
    position: 'absolute',
    bottom: '16px',
    right: '16px',
    padding: '8px 16px',
    fontSize: '11px',
    color: 'var(--fractal-text-secondary)',
    opacity: 0.7,
    transition: 'opacity 150ms ease',
  }}
>
```

- [ ] **Step 5: Update `ControlsPanel.tsx` — use `glassBaseStyle`, `dividerStyle`, and `getThemeNames()`**

Replace `glassPanel` const (lines 37-53):

```ts
import { glassBaseStyle, dividerStyle } from './styles';

const glassPanel: React.CSSProperties = {
  ...glassBaseStyle,
  position: 'absolute',
  top: '16px',
  right: '16px',
  borderRadius: '16px',
  padding: '16px',
  minWidth: '260px',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
  color: 'var(--fractal-text-primary)',
  zIndex: 100
};
```

Replace the collapsed button glass styles (lines 112-124):

```tsx
style={{
  ...glassBaseStyle,
  position: 'absolute',
  top: '16px',
  right: '16px',
  width: '44px',
  height: '44px',
  color: 'var(--fractal-text-primary)',
  fontSize: '20px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}}
```

Replace the two divider `<div>` (lines 270, 321) with `<div style={dividerStyle} />`.

Replace `themeOptions` (line 35) — remove the const, import `getThemeNames`:

```ts
import { getThemeLabel, getThemeNames } from './themes';
```

And in the template (line 280): `{getThemeNames().map((t) => (`.

- [ ] **Step 6: Update `src/ui/index.ts`**

Add exports:

```ts
export { glassBaseStyle, dividerStyle, labelStyle, selectStyle } from './styles';
export { getThemeNames } from './themes';
```

- [ ] **Step 7: Commit**

```
refactor(ui): extract shared glass styles and getThemeNames
```

---

## Task 3: Julia defaults — single source of truth

**Files:**
- Modify: `src/domain/fractals.ts:48-49` — use `DEFAULT_JULIA_PARAMS`
- Modify: `src/ui/ControlsPanel.tsx:97-98` — use `DEFAULT_JULIA_PARAMS`

**Why:** The Julia default values (`-0.7`, `0.27015`) are hardcoded in 4 places: `types.ts:117-120` (canonical), `fractals.ts:48-49`, `ControlsPanel.tsx:97-98`. This creates a risk of silent divergence (ControlsPanel already has `0.27` instead of `0.27015`).

- [ ] **Step 1: Update `fractals.ts` — import and use `DEFAULT_JULIA_PARAMS`**

At the top of `fractals.ts`, add:

```ts
import type { FractalResult, FractalParams, FractalCalculator } from './types';
import { DEFAULT_JULIA_PARAMS } from './types';
```

Replace lines 48-49:

```ts
// Before:
const cRe = params.juliaRe ?? -0.7;
const cIm = params.juliaIm ?? 0.27015;

// After:
const cRe = params.juliaRe ?? DEFAULT_JULIA_PARAMS.juliaRe!;
const cIm = params.juliaIm ?? DEFAULT_JULIA_PARAMS.juliaIm!;
```

- [ ] **Step 2: Update `ControlsPanel.tsx` — import and use `DEFAULT_JULIA_PARAMS`**

Add `DEFAULT_JULIA_PARAMS` to the domain import (line 9).

Replace `formatJuliaCoords` (lines 96-101):

```ts
const formatJuliaCoords = () => {
  const re = juliaParams.juliaRe ?? DEFAULT_JULIA_PARAMS.juliaRe!;
  const im = juliaParams.juliaIm ?? DEFAULT_JULIA_PARAMS.juliaIm!;
  const sign = im >= 0 ? '+' : '';
  return `c = ${re.toFixed(4)} ${sign} ${im.toFixed(4)}i`;
};
```

This also fixes the existing bug: ControlsPanel had `0.27` (truncated) instead of `0.27015`.

- [ ] **Step 3: Commit**

```
fix(domain): centralize Julia default params, fix truncated 0.27 → 0.27015
```

---

## Task 4: Extract `formatComplexCoords` to domain

**Files:**
- Modify: `src/domain/coordinates.ts` — add `formatComplexCoords()`
- Modify: `src/domain/index.ts` — export new function
- Modify: `src/ui/ControlsPanel.tsx` — use domain function

**Why:** `formatJuliaCoords()` in ControlsPanel is a presentation of complex numbers — it belongs in the domain layer alongside the other coordinate functions. Any future component showing complex coords would need to duplicate this.

- [ ] **Step 1: Add `formatComplexCoords` to `coordinates.ts`**

Append after `getZoomLevel` (after line 79):

```ts
/**
 * Format complex number as human-readable string
 * Example: "c = -0.7000 + 0.2702i"
 */
export function formatComplexCoords(
  re: number,
  im: number,
  precision: number = 4
): string {
  const sign = im >= 0 ? '+' : '';
  return `c = ${re.toFixed(precision)} ${sign} ${im.toFixed(precision)}i`;
}
```

- [ ] **Step 2: Export from `src/domain/index.ts`**

Add `formatComplexCoords` to the coordinates export block.

- [ ] **Step 3: Update `ControlsPanel.tsx`**

Import `formatComplexCoords` from domain. Replace the `formatJuliaCoords` closure:

```ts
const juliaLabel = formatComplexCoords(
  juliaParams.juliaRe ?? DEFAULT_JULIA_PARAMS.juliaRe!,
  juliaParams.juliaIm ?? DEFAULT_JULIA_PARAMS.juliaIm!
);
```

Use `{juliaLabel}` where `{formatJuliaCoords()}` was called (line 241).

- [ ] **Step 4: Commit**

```
refactor(domain): extract formatComplexCoords to coordinates.ts
```

---

## Task 5: Extract `canvasUtils.ts` from `renderer.ts`

**Files:**
- Create: `src/infrastructure/canvasUtils.ts`
- Modify: `src/infrastructure/renderer.ts` — remove 3 utility functions
- Modify: `src/infrastructure/useRenderer.ts` — update import
- Modify: `src/infrastructure/index.ts` — update barrel

**Why:** `renderer.ts` mixes fractal rendering (`renderFractal`) with generic canvas utilities (`resizeCanvas`, `exportCanvas`, `downloadCanvas`). SRP: the renderer should only know about rendering.

- [ ] **Step 1: Create `src/infrastructure/canvasUtils.ts`**

```ts
/**
 * Generic canvas utility functions
 * No fractal-specific logic
 */

/**
 * Resize canvas to fill container with device pixel ratio support
 */
export function resizeCanvas(canvas: HTMLCanvasElement, container: HTMLElement): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
}

/**
 * Export canvas to PNG data URL
 */
export function exportCanvas(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/**
 * Download canvas as PNG file
 */
export function downloadCanvas(canvas: HTMLCanvasElement, label: string): void {
  const link = document.createElement('a');
  link.download = `fractal-${label}-${Date.now()}.png`;
  link.href = exportCanvas(canvas);
  link.click();
}
```

- [ ] **Step 2: Remove utilities from `renderer.ts`**

Delete `resizeCanvas` (lines 93-101), `exportCanvas` (lines 106-108), `downloadCanvas` (lines 113-118) from `renderer.ts`. Only `renderFractal` remains.

- [ ] **Step 3: Update `useRenderer.ts` import**

```ts
// Before:
import { renderFractal, resizeCanvas, downloadCanvas } from './renderer';

// After:
import { renderFractal } from './renderer';
import { resizeCanvas, downloadCanvas } from './canvasUtils';
```

- [ ] **Step 4: Update `src/infrastructure/index.ts`**

```ts
export { renderFractal } from './renderer';
export { resizeCanvas, exportCanvas, downloadCanvas } from './canvasUtils';
export { useRenderer } from './useRenderer';
```

- [ ] **Step 5: Commit**

```
refactor(infra): extract canvas utilities from renderer
```

---

## Task 6: Split `ControlsPanel` into sub-sections

**Files:**
- Create: `src/ui/controls/FractalTypeSection.tsx`
- Create: `src/ui/controls/JuliaSection.tsx`
- Create: `src/ui/controls/AppearanceSection.tsx`
- Create: `src/ui/controls/ActionsSection.tsx`
- Modify: `src/ui/ControlsPanel.tsx` — thin assembler

**Why:** `ControlsPanel` is 360 lines with 6 distinct sections. SRP: each section has its own props, its own conditional logic (Julia), and its own layout concerns.

- [ ] **Step 1: Create shared types for sections**

Each section needs its own interface. Define them inline in each file to keep things co-located.

- [ ] **Step 2: Create `src/ui/controls/FractalTypeSection.tsx`**

Extracted from ControlsPanel lines 168-201.

```tsx
import React from 'react';
import type { FractalType } from '../../domain';
import { getFractalTypeNames, getFractalLabel, getFractalConfig } from '../../domain';
import { labelStyle, selectStyle } from '../styles';

interface FractalTypeSectionProps {
  fractalType: FractalType;
  onFractalTypeChange: (type: FractalType) => void;
}

export const FractalTypeSection: React.FC<FractalTypeSectionProps> = ({
  fractalType,
  onFractalTypeChange
}) => {
  const config = getFractalConfig(fractalType);

  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Type de fractale</label>
      <select
        value={fractalType}
        onChange={(e) => onFractalTypeChange(e.target.value as FractalType)}
        style={selectStyle}
      >
        {getFractalTypeNames().map((type) => (
          <option key={type} value={type}>
            {getFractalLabel(type)}
          </option>
        ))}
      </select>
      <div style={{
        fontSize: '11px',
        color: 'var(--fractal-text-secondary)',
        padding: '8px',
        background: 'var(--fractal-bg-secondary)',
        borderRadius: '6px',
        marginTop: '4px',
        lineHeight: 1.4
      }}>
        <span style={{
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          color: 'var(--fractal-accent-primary)',
          fontSize: '12px'
        }}>
          {config.formula}
        </span>
        <br />
        {config.description}
      </div>
    </div>
  );
};
```

Note: uses `getFractalLabel(type)` instead of `getFractalConfig(type).name` — fixes DRY issue #5.

- [ ] **Step 3: Create `src/ui/controls/JuliaSection.tsx`**

Extracted from ControlsPanel lines 203-267.

```tsx
import React from 'react';
import type { FractalParams } from '../../domain';
import { DEFAULT_JULIA_PARAMS, JULIA_PRESETS, formatComplexCoords } from '../../domain';
import { labelStyle, selectStyle } from '../styles';

interface JuliaSectionProps {
  juliaParams: FractalParams;
  isPickingJulia: boolean;
  onJuliaParamsChange: (params: FractalParams) => void;
  onPickJulia: () => void;
}

export const JuliaSection: React.FC<JuliaSectionProps> = ({
  juliaParams,
  isPickingJulia,
  onJuliaParamsChange,
  onPickJulia
}) => {
  const juliaLabel = formatComplexCoords(
    juliaParams.juliaRe ?? DEFAULT_JULIA_PARAMS.juliaRe!,
    juliaParams.juliaIm ?? DEFAULT_JULIA_PARAMS.juliaIm!
  );

  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Paramètre Julia (c)</label>
      <button
        onClick={onPickJulia}
        style={{
          width: '100%',
          padding: '8px 12px',
          background: 'var(--fractal-bg-secondary)',
          border: '1px solid var(--fractal-border-color)',
          borderRadius: '8px',
          color: 'var(--fractal-text-primary)',
          fontSize: '12px',
          cursor: 'pointer',
          marginBottom: '8px'
        }}
      >
        🎯 Choisir sur Mandelbrot
      </button>

      {isPickingJulia && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--fractal-accent-glow)',
          border: '1px solid var(--fractal-accent-primary)',
          borderRadius: '8px',
          fontSize: '11px',
          textAlign: 'center',
          animation: 'fractal-pulse 1.5s ease-in-out infinite'
        }}>
          Cliquez sur Mandelbrot pour choisir c
          <div style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: '10px',
            color: 'var(--fractal-accent-primary)',
            marginTop: '4px'
          }}>
            {juliaLabel}
          </div>
        </div>
      )}

      <div style={{ marginTop: '8px' }}>
        <label style={labelStyle}>Presets Julia</label>
        <select
          onChange={(e) => {
            if (e.target.value) {
              const [re, im] = e.target.value.split(',').map(Number);
              onJuliaParamsChange({ juliaRe: re, juliaIm: im });
            }
          }}
          style={selectStyle}
          defaultValue=""
        >
          <option value="">Personnalisé</option>
          {JULIA_PRESETS.map((preset) => (
            <option key={preset.name} value={`${preset.re},${preset.im}`}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Create `src/ui/controls/AppearanceSection.tsx`**

Extracted from ControlsPanel lines 272-318. Combines theme, palette, iterations — they form a cohesive "appearance" group.

```tsx
import React from 'react';
import type { ThemeName, PaletteName } from '../../domain';
import { getPaletteNames, getPaletteLabel } from '../../domain';
import { getThemeLabel, getThemeNames } from '../themes';
import { labelStyle, selectStyle } from '../styles';

interface AppearanceSectionProps {
  theme: ThemeName;
  palette: PaletteName;
  maxIterations: number;
  onThemeChange: (theme: ThemeName) => void;
  onPaletteChange: (palette: PaletteName) => void;
  onIterationsChange: (iterations: number) => void;
}

export const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  theme,
  palette,
  maxIterations,
  onThemeChange,
  onPaletteChange,
  onIterationsChange
}) => (
  <>
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Theme</label>
      <select
        value={theme}
        onChange={(e) => onThemeChange(e.target.value as ThemeName)}
        style={selectStyle}
      >
        {getThemeNames().map((t) => (
          <option key={t} value={t}>{getThemeLabel(t)}</option>
        ))}
      </select>
    </div>

    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Palette de couleurs</label>
      <select
        value={palette}
        onChange={(e) => onPaletteChange(e.target.value as PaletteName)}
        style={selectStyle}
      >
        {getPaletteNames().map((p) => (
          <option key={p} value={p}>{getPaletteLabel(p)}</option>
        ))}
      </select>
    </div>

    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>Iterations max: {maxIterations}</label>
      <input
        type="range"
        min="50"
        max="1000"
        value={maxIterations}
        onChange={(e) => onIterationsChange(parseInt(e.target.value, 10))}
        style={{
          width: '100%',
          height: '4px',
          background: 'var(--fractal-bg-secondary)',
          borderRadius: '2px',
          outline: 'none',
          cursor: 'pointer'
        }}
      />
    </div>
  </>
);
```

- [ ] **Step 5: Create `src/ui/controls/ActionsSection.tsx`**

Extracted from ControlsPanel lines 323-357.

```tsx
import React from 'react';

interface ActionsSectionProps {
  onReset: () => void;
  onExport: () => void;
}

export const ActionsSection: React.FC<ActionsSectionProps> = ({ onReset, onExport }) => (
  <div style={{ display: 'flex', gap: '8px' }}>
    <button
      onClick={onReset}
      style={{
        flex: 1,
        padding: '8px 16px',
        background: 'linear-gradient(135deg, var(--fractal-accent-primary), var(--fractal-accent-secondary))',
        border: 'none',
        borderRadius: '8px',
        color: 'white',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer'
      }}
    >
      🔄 Reset
    </button>
    <button
      onClick={onExport}
      style={{
        flex: 1,
        padding: '8px 16px',
        background: 'var(--fractal-bg-secondary)',
        border: '1px solid var(--fractal-border-color)',
        borderRadius: '8px',
        color: 'var(--fractal-text-primary)',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer'
      }}
    >
      📷 Export
    </button>
  </div>
);
```

- [ ] **Step 6: Rewrite `ControlsPanel.tsx` as thin assembler**

The new ControlsPanel only manages collapse state and composes sub-sections:

```tsx
import React, { useState } from 'react';
import type { ThemeName, PaletteName, FractalType, FractalParams } from '../domain';
import { glassBaseStyle, dividerStyle } from './styles';
import { FractalTypeSection } from './controls/FractalTypeSection';
import { JuliaSection } from './controls/JuliaSection';
import { AppearanceSection } from './controls/AppearanceSection';
import { ActionsSection } from './controls/ActionsSection';

interface ControlsPanelProps {
  fractalType: FractalType;
  theme: ThemeName;
  palette: PaletteName;
  maxIterations: number;
  juliaParams: FractalParams;
  isPickingJulia: boolean;
  onFractalTypeChange: (type: FractalType) => void;
  onThemeChange: (theme: ThemeName) => void;
  onPaletteChange: (palette: PaletteName) => void;
  onIterationsChange: (iterations: number) => void;
  onJuliaParamsChange: (params: FractalParams) => void;
  onPickJulia: () => void;
  onReset: () => void;
  onExport: () => void;
}

const panelStyle: React.CSSProperties = {
  ...glassBaseStyle,
  position: 'absolute',
  top: '16px',
  right: '16px',
  borderRadius: '16px',
  padding: '16px',
  minWidth: '260px',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
  color: 'var(--fractal-text-primary)',
  zIndex: 100
};

const collapsedButtonStyle: React.CSSProperties = {
  ...glassBaseStyle,
  position: 'absolute',
  top: '16px',
  right: '16px',
  width: '44px',
  height: '44px',
  color: 'var(--fractal-text-primary)',
  fontSize: '20px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
  fractalType,
  theme,
  palette,
  maxIterations,
  juliaParams,
  isPickingJulia,
  onFractalTypeChange,
  onThemeChange,
  onPaletteChange,
  onIterationsChange,
  onJuliaParamsChange,
  onPickJulia,
  onReset,
  onExport
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        style={collapsedButtonStyle}
        title="Afficher les contrôles"
      >
        ⚙️
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--fractal-border-color)'
      }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 600,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: 'var(--fractal-text-secondary)'
        }}>
          Fractal Explorer
        </span>
        <button
          onClick={() => setIsCollapsed(true)}
          style={{
            padding: '4px 8px',
            background: 'var(--fractal-bg-secondary)',
            border: '1px solid var(--fractal-border-color)',
            borderRadius: '6px',
            color: 'var(--fractal-text-primary)',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          ✕
        </button>
      </div>

      <FractalTypeSection
        fractalType={fractalType}
        onFractalTypeChange={onFractalTypeChange}
      />

      {fractalType === 'julia' && (
        <JuliaSection
          juliaParams={juliaParams}
          isPickingJulia={isPickingJulia}
          onJuliaParamsChange={onJuliaParamsChange}
          onPickJulia={onPickJulia}
        />
      )}

      <div style={dividerStyle} />

      <AppearanceSection
        theme={theme}
        palette={palette}
        maxIterations={maxIterations}
        onThemeChange={onThemeChange}
        onPaletteChange={onPaletteChange}
        onIterationsChange={onIterationsChange}
      />

      <div style={dividerStyle} />

      <ActionsSection onReset={onReset} onExport={onExport} />
    </div>
  );
};
```

- [ ] **Step 7: Commit**

```
refactor(ui): split ControlsPanel into focused sub-sections
```

---

## Task 7: Init props via `useFractalState` parameter

**Files:**
- Modify: `src/application/useFractalState.ts` — accept `initialConfig` parameter
- Modify: `src/FractalExplorer.tsx` — remove init `useEffect`, pass config to hook

**Why:** The `useEffect` at `FractalExplorer.tsx:88-93` dispatches up to 4 actions after mount, causing unnecessary re-renders. The initial values belong in the reducer's `initialState`, not as post-mount side effects. This is also a SRP violation — the component shouldn't manage state initialization.

- [ ] **Step 1: Update `useFractalState` to accept initial overrides**

Add an optional parameter to the hook:

```ts
/** Optional initial config overrides */
export interface InitialFractalConfig {
  fractalType?: FractalType;
  theme?: ThemeName;
  palette?: PaletteName;
  maxIterations?: number;
}

export function useFractalState(initial?: InitialFractalConfig) {
  const resolvedInitial: FractalState = {
    ...initialState,
    ...(initial?.fractalType && {
      fractalType: initial.fractalType,
      viewport: getDefaultViewport(initial.fractalType),
    }),
    ...(initial?.theme && { theme: initial.theme }),
    ...(initial?.palette && { palette: initial.palette }),
    ...(initial?.maxIterations !== undefined && { maxIterations: initial.maxIterations }),
  };

  const [state, dispatch] = useReducer(fractalReducer, resolvedInitial);
  // ... rest unchanged
```

- [ ] **Step 2: Update `FractalExplorer.tsx`**

Remove the init `useEffect` (lines 88-93). Pass props to hook:

```tsx
// Before:
const { state, stats, actions } = useFractalState();

useEffect(() => {
  if (initialFractalType !== 'mandelbrot') actions.setFractalType(initialFractalType);
  if (initialTheme !== 'default') actions.setTheme(initialTheme);
  if (initialPalette !== 'classic') actions.setPalette(initialPalette);
  if (initialIterations !== 256) actions.setIterations(initialIterations);
}, []);

// After:
const { state, stats, actions } = useFractalState({
  fractalType: initialFractalType,
  theme: initialTheme,
  palette: initialPalette,
  maxIterations: initialIterations,
});
```

Also remove `useEffect` from the React import if no longer needed.

- [ ] **Step 3: Commit**

```
refactor(state): init config via hook parameter instead of post-mount effects
```

---

## Task 8: Final barrel exports cleanup

**Files:**
- Modify: `src/ui/index.ts` — final state with all new exports
- Modify: `src/infrastructure/index.ts` — already done in Task 5
- Modify: `src/domain/index.ts` — already done in Task 4
- Verify: `src/index.ts` — ensure root barrel still works

**Why:** After all extractions, the barrel files need to reflect the new file structure. This is the final pass to ensure everything is wired up.

- [ ] **Step 1: Finalize `src/ui/index.ts`**

```ts
// Components
export { ControlsPanel } from './ControlsPanel';
export { InfoPanel } from './InfoPanel';
export { HelpTooltip } from './HelpTooltip';
export { LoadingOverlay } from './LoadingOverlay';
export { Kbd } from './Kbd';

// Sub-sections (for advanced usage / testing)
export { FractalTypeSection } from './controls/FractalTypeSection';
export { JuliaSection } from './controls/JuliaSection';
export { AppearanceSection } from './controls/AppearanceSection';
export { ActionsSection } from './controls/ActionsSection';

// Styles
export { glassBaseStyle, dividerStyle, labelStyle, selectStyle } from './styles';

// Themes
export {
  themes,
  getThemeCSSVariables,
  getThemeLabel,
  getThemeNames,
  keyframesCSS
} from './themes';

export type { ThemeColors } from './themes';
```

- [ ] **Step 2: Verify `src/index.ts` root barrel**

Add `formatComplexCoords` to the existing domain export block in `src/index.ts` (line 29). Do NOT create a second `export { ... } from './domain'` block — add it to the existing one:

```ts
// In src/index.ts, modify the existing block at line 29:
export {
  calculateMandelbrot,
  calculateJulia,
  calculateBurningShip,
  calculateTricorn,
  calculateMultibrot,
  fractalTypes,
  getFractalConfig,
  getFractalLabel,
  palettes,
  getColor,
  getPaletteNames,
  getPaletteLabel,
  screenToComplex,
  formatComplexCoords,
  JULIA_PRESETS
} from './domain';
```

- [ ] **Step 3: Commit**

```
refactor: finalize barrel exports after DRY/SRP cleanup
```

---

## Summary

| Task | Files touched | Key change |
|------|-------------|-----------|
| 1 | 6 | Split `components.tsx` → 4 files |
| 2 | 6 | `glassBaseStyle` + `getThemeNames()` |
| 3 | 2 | Julia defaults single source |
| 4 | 3 | `formatComplexCoords` in domain |
| 5 | 4 | `canvasUtils.ts` extraction |
| 6 | 6 | Split `ControlsPanel` → 4 sub-sections |
| 7 | 2 | Init props via hook param |
| 8 | 2 | Barrel cleanup |

**Before:** 10 source files, 1630 lines, 3 DRY violations, 4 SRP violations.
**After:** 19 source files, ~1650 lines (slight growth from explicit interfaces), 0 DRY violations, 0 SRP violations. Each file has one clear responsibility.
