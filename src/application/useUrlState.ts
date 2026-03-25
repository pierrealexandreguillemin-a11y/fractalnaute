/**
 * ===================================================================
 * APPLICATION LAYER - URL State Persistence
 * Encodes/decodes fractal explorer state in the URL hash for sharing.
 * Pure functions (parseHash, buildHash) + sync hook (useUrlState).
 * ===================================================================
 */

import { useEffect, useRef, useMemo } from 'react';
import type { FractalType, PaletteName, ColoringMode } from '../domain';
import { getFractalTypeNames, getPaletteNames, COLORING_MODES } from '../domain';
import type { InitialFractalConfig } from './useFractalState';

/** URL-serializable subset of state */
export interface UrlState {
  centerRe: number;
  centerIm: number;
  scale: number;
  fractalType: FractalType;
  maxIterations: number;
  palette: PaletteName;
  coloringMode: ColoringMode;
  interiorColoring: boolean;
  ssaa: boolean;
  juliaRe: number;
  juliaIm: number;
}

const DEBOUNCE_MS = 200;

// ── Validators (cached) ──────────────────────────────────────────

const VALID_FRACTALS = new Set<string>(getFractalTypeNames());
const VALID_PALETTES = new Set<string>(getPaletteNames());
const VALID_COLORING = new Set<string>(COLORING_MODES);

function isValidFractal(v: string): v is FractalType {
  return VALID_FRACTALS.has(v);
}

function isValidPalette(v: string): v is PaletteName {
  return VALID_PALETTES.has(v);
}

function isValidColoring(v: string): v is ColoringMode {
  return VALID_COLORING.has(v);
}

// ── Pure parse helpers ───────────────────────────────────────────

/** Parse a finite number from string, or undefined */
function parseNum(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse a boolean from '0'/'1', or undefined */
function parseBool(raw: string | null): boolean | undefined {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return undefined;
}

/** Parse viewport fields from URLSearchParams */
function parseViewportParams(
  params: URLSearchParams,
  result: Partial<InitialFractalConfig>
): void {
  const re = parseNum(params.get('re'));
  const im = parseNum(params.get('im'));
  const s = parseNum(params.get('s'));
  if (re !== undefined) result.centerRe = re;
  if (im !== undefined) result.centerIm = im;
  if (s !== undefined && s > 0) result.scale = s;
}

/** Parse enum/discrete fields from URLSearchParams */
function parseDiscreteParams(
  params: URLSearchParams,
  result: Partial<InitialFractalConfig>
): void {
  const f = params.get('f');
  if (f !== null && isValidFractal(f)) result.fractalType = f;

  const i = parseNum(params.get('i'));
  if (i !== undefined && i > 0 && Number.isInteger(i)) result.maxIterations = i;

  const p = params.get('p');
  if (p !== null && isValidPalette(p)) result.palette = p;

  const c = params.get('c');
  if (c !== null && isValidColoring(c)) result.coloringMode = c;
}

/** Parse boolean toggle fields from URLSearchParams */
function parseBoolParams(
  params: URLSearchParams,
  result: Partial<InitialFractalConfig>
): void {
  const ic = parseBool(params.get('ic'));
  if (ic !== undefined) result.interiorColoring = ic;

  const ssaa = parseBool(params.get('ssaa'));
  if (ssaa !== undefined) result.ssaa = ssaa;
}

/** Parse Julia set parameters from URLSearchParams */
function parseJuliaParams(
  params: URLSearchParams,
  result: Partial<InitialFractalConfig>
): void {
  const jre = parseNum(params.get('jre'));
  if (jre !== undefined) result.juliaRe = jre;
  const jim = parseNum(params.get('jim'));
  if (jim !== undefined) result.juliaIm = jim;
}

// ── Public pure functions ────────────────────────────────────────

/** Parse URL hash into partial initial config. Invalid values silently ignored. */
export function parseHash(hash: string): Partial<InitialFractalConfig> {
  if (!hash || hash.length < 2) return {};
  const params = new URLSearchParams(hash.slice(1));
  const result: Partial<InitialFractalConfig> = {};
  parseViewportParams(params, result);
  parseDiscreteParams(params, result);
  parseBoolParams(params, result);
  parseJuliaParams(params, result);
  return result;
}

/** Build a URL hash string from serializable state */
export function buildHash(state: UrlState): string {
  const params = new URLSearchParams();
  params.set('re', formatCoord(state.centerRe));
  params.set('im', formatCoord(state.centerIm));
  params.set('s', formatCoord(state.scale));
  params.set('f', state.fractalType);
  params.set('i', String(state.maxIterations));
  params.set('p', state.palette);
  params.set('c', state.coloringMode);
  params.set('ic', state.interiorColoring ? '1' : '0');
  params.set('ssaa', state.ssaa ? '1' : '0');
  params.set('jre', formatCoord(state.juliaRe));
  params.set('jim', formatCoord(state.juliaIm));
  return `#${params.toString()}`;
}

/** Format a coordinate with enough precision to avoid drift */
function formatCoord(n: number): string {
  const raw = n.toPrecision(15);
  // Strip trailing zeros after decimal point, then trailing dot
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) return raw;
  let end = raw.length;
  while (end > dotIdx + 1 && raw[end - 1] === '0') end--;
  if (raw[end - 1] === '.') end--;
  return raw.slice(0, end);
}

// ── Hooks ────────────────────────────────────────────────────────

/**
 * Read initial config from URL hash on mount.
 * Returns Partial<InitialFractalConfig> to merge with defaults.
 */
export function useUrlInitialConfig(): Partial<InitialFractalConfig> {
  return useMemo(() => {
    if (typeof window === 'undefined') return {};
    return parseHash(window.location.hash);
  }, []);
}

/**
 * Sync state changes to URL hash via history.replaceState.
 * Debounced to avoid spamming the browser history API.
 */
export function useUrlSync(urlState: UrlState
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      const newHash = buildHash(urlState);
      const currentHash = window.location.hash;
      if (currentHash !== newHash) {
        history.replaceState(null, '', newHash);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- urlState fields are stable values
  }, [urlState.centerRe, urlState.centerIm, urlState.scale, urlState.fractalType,
      urlState.maxIterations, urlState.palette, urlState.coloringMode,
      urlState.interiorColoring, urlState.ssaa, urlState.juliaRe, urlState.juliaIm]);
}
