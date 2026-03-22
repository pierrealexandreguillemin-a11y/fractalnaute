/**
 * ===================================================================
 * APPLICATION LAYER - Canvas Event Handling
 * Mouse, touch, and keyboard event management
 * ===================================================================
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Viewport } from '../domain';
import { screenToComplex } from '../domain';
import type { FractalActions } from './useFractalState';

interface CanvasDimensions {
  width: number;
  height: number;
  rect: DOMRect | null;
}

interface UseCanvasEventsOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewport: Viewport;
  fractalType: string;
  isPickingJulia: boolean;
  actions: FractalActions;
  onJuliaPick?: (re: number, im: number) => void;
}

/** Shared canvas dimension getter */
function getCanvasDims(canvas: HTMLCanvasElement | null): CanvasDimensions {
  if (!canvas) return { width: 0, height: 0, rect: null };
  return { width: canvas.width, height: canvas.height, rect: canvas.getBoundingClientRect() };
}

/** Convert client coordinates to canvas pixel coordinates */
function toCanvasCoords(clientX: number, clientY: number, dims: CanvasDimensions) {
  if (!dims.rect) return { x: 0, y: 0 };
  return {
    x: (clientX - dims.rect.left) * (dims.width / dims.rect.width),
    y: (clientY - dims.rect.top) * (dims.height / dims.rect.height)
  };
}

/** Hook: mouse event handlers (wheel, drag, click, dblclick) */
function useMouseHandlers(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewport: Viewport,
  isPickingJulia: boolean,
  actions: FractalActions,
  onJuliaPick?: (re: number, im: number) => void
) {
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const dims = getCanvasDims(canvasRef.current);
    const pos = toCanvasCoords(e.clientX, e.clientY, dims);
    const c = screenToComplex(pos.x, pos.y, dims.width, dims.height, viewport);
    actions.zoom(e.deltaY > 0 ? 1.4 : 0.7, c.re, c.im);
  }, [canvasRef, viewport, actions]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
  }, [canvasRef]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const dims = getCanvasDims(canvasRef.current);
    if (!dims.rect) return;
    const aspectRatio = dims.width / dims.height;
    const dx = (e.clientX - lastPos.current.x) / dims.rect.width * viewport.scale * aspectRatio;
    const dy = (e.clientY - lastPos.current.y) / dims.rect.height * viewport.scale;
    actions.pan(-dx, -dy);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [canvasRef, viewport, actions]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
  }, [canvasRef]);

  const handleClick = useCallback((e: MouseEvent) => {
    if (!isPickingJulia || !onJuliaPick) return;
    const dims = getCanvasDims(canvasRef.current);
    const pos = toCanvasCoords(e.clientX, e.clientY, dims);
    const c = screenToComplex(pos.x, pos.y, dims.width, dims.height, viewport);
    onJuliaPick(c.re, c.im);
  }, [isPickingJulia, onJuliaPick, canvasRef, viewport]);

  const handleDoubleClick = useCallback((e: MouseEvent) => {
    if (isPickingJulia) return;
    const dims = getCanvasDims(canvasRef.current);
    const pos = toCanvasCoords(e.clientX, e.clientY, dims);
    const c = screenToComplex(pos.x, pos.y, dims.width, dims.height, viewport);
    actions.zoom(0.5, c.re, c.im);
  }, [isPickingJulia, canvasRef, viewport, actions]);

  return { handleWheel, handleMouseDown, handleMouseMove, handleMouseUp, handleClick, handleDoubleClick };
}

/** Hook: touch event handlers (pan + pinch zoom) */
function useTouchHandlers(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewport: Viewport,
  actions: FractalActions
) {
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const touchDist = useRef(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 1 && t0) {
      isDragging.current = true;
      lastPos.current = { x: t0.clientX, y: t0.clientY };
    } else if (e.touches.length === 2 && t0 && t1) {
      isDragging.current = false;
      touchDist.current = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const t0 = e.touches[0];
    const t1 = e.touches[1];

    if (e.touches.length === 1 && isDragging.current && t0) {
      const dims = getCanvasDims(canvasRef.current);
      if (!dims.rect) return;
      const ar = dims.width / dims.height;
      const dx = (t0.clientX - lastPos.current.x) / dims.rect.width * viewport.scale * ar;
      const dy = (t0.clientY - lastPos.current.y) / dims.rect.height * viewport.scale;
      actions.pan(-dx, -dy);
      lastPos.current = { x: t0.clientX, y: t0.clientY };
      return;
    }

    if (e.touches.length === 2 && t0 && t1) {
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const cx = (t0.clientX + t1.clientX) / 2;
      const cy = (t0.clientY + t1.clientY) / 2;
      const dims = getCanvasDims(canvasRef.current);
      const pos = toCanvasCoords(cx, cy, dims);
      const c = screenToComplex(pos.x, pos.y, dims.width, dims.height, viewport);
      actions.zoom(touchDist.current / dist, c.re, c.im);
      touchDist.current = dist;
    }
  }, [canvasRef, viewport, actions]);

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  return { handleTouchStart, handleTouchMove, handleTouchEnd };
}

/** Hook: keyboard shortcuts */
function useKeyboardHandler(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewport: Viewport,
  isPickingJulia: boolean,
  actions: FractalActions
) {
  return useCallback((e: KeyboardEvent) => {
    if (e.key === 'r' || e.key === 'R') {
      actions.reset();
    } else if (e.key === 'Escape' && isPickingJulia) {
      actions.setPickingJulia(false);
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      const dims = getCanvasDims(canvasRef.current);
      const c = screenToComplex(dims.width / 2, dims.height / 2, dims.width, dims.height, viewport);
      actions.zoom(e.key === '-' ? 1.4 : 0.7, c.re, c.im);
    }
  }, [canvasRef, viewport, actions, isPickingJulia]);
}

/**
 * Custom hook for handling all canvas interactions.
 * Delegates to focused sub-hooks for mouse, touch, and keyboard.
 */
export function useCanvasEvents({
  canvasRef,
  viewport,
  isPickingJulia,
  actions,
  onJuliaPick
}: UseCanvasEventsOptions) {
  const mouse = useMouseHandlers(canvasRef, viewport, isPickingJulia, actions, onJuliaPick);
  const touch = useTouchHandlers(canvasRef, viewport, actions);
  const handleKeyDown = useKeyboardHandler(canvasRef, viewport, isPickingJulia, actions);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('wheel', mouse.handleWheel, { passive: false });
    canvas.addEventListener('mousedown', mouse.handleMouseDown);
    canvas.addEventListener('click', mouse.handleClick);
    canvas.addEventListener('dblclick', mouse.handleDoubleClick);
    canvas.addEventListener('touchstart', touch.handleTouchStart, { passive: true });
    canvas.addEventListener('touchmove', touch.handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', touch.handleTouchEnd);
    window.addEventListener('mousemove', mouse.handleMouseMove);
    window.addEventListener('mouseup', mouse.handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('wheel', mouse.handleWheel);
      canvas.removeEventListener('mousedown', mouse.handleMouseDown);
      canvas.removeEventListener('click', mouse.handleClick);
      canvas.removeEventListener('dblclick', mouse.handleDoubleClick);
      canvas.removeEventListener('touchstart', touch.handleTouchStart);
      canvas.removeEventListener('touchmove', touch.handleTouchMove);
      canvas.removeEventListener('touchend', touch.handleTouchEnd);
      window.removeEventListener('mousemove', mouse.handleMouseMove);
      window.removeEventListener('mouseup', mouse.handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [canvasRef, mouse, touch, handleKeyDown]);
}
