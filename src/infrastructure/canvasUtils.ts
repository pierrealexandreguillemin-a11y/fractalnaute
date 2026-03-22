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
 * Cached ImageData — reused when canvas dimensions haven't changed.
 * Avoids ~1.2MB allocation per render at 1920×1080.
 */
let cachedImageData: ImageData | null = null;
let cachedWidth = 0;
let cachedHeight = 0;

export function getOrCreateImageData(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): ImageData {
  if (cachedImageData && cachedWidth === width && cachedHeight === height) {
    return cachedImageData;
  }
  cachedImageData = ctx.createImageData(width, height);
  cachedWidth = width;
  cachedHeight = height;
  return cachedImageData;
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
