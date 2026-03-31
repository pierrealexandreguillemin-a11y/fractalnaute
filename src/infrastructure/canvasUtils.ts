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
 * Cached ImageData per context — reused when canvas dimensions haven't changed.
 * WeakMap keyed by ctx avoids cross-canvas corruption and allows GC when ctx is released.
 */
const imageDataCache = new WeakMap<CanvasRenderingContext2D, { data: ImageData; w: number; h: number }>();

export function getOrCreateImageData(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): ImageData {
  const entry = imageDataCache.get(ctx);
  if (entry && entry.w === width && entry.h === height) {
    return entry.data;
  }
  const data = ctx.createImageData(width, height);
  imageDataCache.set(ctx, { data, w: width, h: height });
  return data;
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
