/**
 * Playwright benchmark — perturbation theory performance at 3 zoom depths.
 *
 * Measures: total time (navigation → render), GPU render time (from InfoPanel).
 * Orbit WASM time = total - GPU render time.
 * Coordinates from Plan B Task 5.
 *
 * Run: npx playwright test e2e/perturbation-benchmark.spec.ts
 * Requires: npm run dev on localhost:3000
 */

import { test, expect } from '@playwright/test';

interface BenchmarkResult {
  label: string;
  zoom: string;
  orbitMs: number;
  gpuMs: number;
  totalMs: number;
  backend: string;
  precision: string;
}

const COORDINATES = [
  {
    label: 'Overlap (DS→perturbation boundary)',
    re: '-0.75',
    im: '0.1',
    scale: '5e-14',
    zoom: '10^-14',
  },
  {
    label: 'Deep (Misiurewicz)',
    re: '-1.768778833',
    im: '-0.001738996',
    scale: '1e-20',
    zoom: '10^-20',
  },
  {
    label: 'Very deep (seahorse valley)',
    re: '-0.7436438885706',
    im: '0.1318259043124',
    scale: '1e-40',
    zoom: '10^-40',
  },
];

/** Build URL hash — use base64 for deep zoom (scale < 1e-13) */
function buildHash(re: string, im: string, scale: string): string {
  const s = parseFloat(scale);
  if (s < 1e-13) {
    const dre = btoa(re);
    const dim = btoa(im);
    const ds = btoa(scale);
    return `#dre=${dre}&dim=${dim}&ds=${ds}&f=mandelbrot&i=256&c=classic&p=classic&ic=0&ssaa=0`;
  }
  return `#re=${re}&im=${im}&s=${scale}&f=mandelbrot&i=256&c=classic&p=classic&ic=0&ssaa=0`;
}

test.describe('Perturbation benchmarks', () => {
  test.setTimeout(180_000);

  for (const coord of COORDINATES) {
    test(`benchmark ${coord.zoom}: ${coord.label}`, async ({ page }) => {
      const hash = buildHash(coord.re, coord.im, coord.scale);
      const url = `http://localhost:3000/${hash}`;

      // Navigate and start timing
      const totalStart = Date.now();
      await page.goto(url);

      // Wait for Perturbation badge AND render time to appear
      await page.waitForFunction(
        () => {
          const body = document.body.textContent ?? '';
          return body.includes('Perturbation') && /Render:\s*[\d.<]+ms/.test(body);
        },
        { timeout: 120_000 }
      );

      // Small settle time
      await page.waitForTimeout(300);

      const totalMs = Date.now() - totalStart;

      // Extract GPU render time from InfoPanel
      const text = await page.locator('body').textContent() ?? '';
      const renderMatch = text.match(/Render:\s*([\d.<]+)ms/);
      let gpuMs = 0;
      if (renderMatch) {
        gpuMs = renderMatch[1].startsWith('<')
          ? 0.5
          : parseFloat(renderMatch[1]);
      }
      const backend = text.includes('GPU') ? 'GPU' : 'CPU';
      const precision = text.includes('Perturbation') ? 'Perturbation' : 'DS';

      // Orbit time = total - GPU - overhead (~300ms settle + navigation)
      const orbitMs = Math.max(0, totalMs - gpuMs - 300);

      const result: BenchmarkResult = {
        label: coord.label,
        zoom: coord.zoom,
        orbitMs: Math.round(orbitMs),
        gpuMs,
        totalMs: Math.round(totalMs),
        backend,
        precision,
      };

      // eslint-disable-next-line no-console -- benchmark output
      console.log(`\n=== BENCHMARK: | ${result.zoom} | ${result.orbitMs}ms | ${result.gpuMs}ms | ${result.totalMs}ms | ${result.label} | ===\n`);

      // Assertions
      expect(backend).toBe('GPU');
      expect(precision).toBe('Perturbation');

      // Screenshot for visual verification (non-black image)
      await page.screenshot({
        path: `e2e/screenshots/${coord.zoom.replace('^', '')}.png`,
        fullPage: false,
      });
    });
  }
});
