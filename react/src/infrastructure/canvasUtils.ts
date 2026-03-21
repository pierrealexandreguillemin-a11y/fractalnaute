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
