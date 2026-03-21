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

// ─── Internal: trig constants ────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

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
  const hRad = H * DEG_TO_RAD;
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
  const H = C < 1e-8 ? 0 : ((Math.atan2(b_, a_) * RAD_TO_DEG) + 360) % 360;

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
