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
  onEscapeCancel?: () => void;
  onFindNucleus?: () => void;
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
    // Pass normalized pixel offset (0=left/top, 1=right/bottom) for deep zoom precision
    const nxOff = dims.width > 0 ? pos.x / dims.width - 0.5 : 0;
    const nyOff = dims.height > 0 ? pos.y / dims.height - 0.5 : 0;
    const ar = dims.width / (dims.height || 1);
    actions.zoom(e.deltaY > 0 ? 1.4 : 0.7, nxOff, nyOff, ar);
  }, [canvasRef, actions]);

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
    const nxOff = dims.width > 0 ? pos.x / dims.width - 0.5 : 0;
    const nyOff = dims.height > 0 ? pos.y / dims.height - 0.5 : 0;
    const ar = dims.width / (dims.height || 1);
    actions.zoom(0.5, nxOff, nyOff, ar);
  }, [isPickingJulia, canvasRef, actions]);

  return { handleWheel, handleMouseDown, handleMouseMove, handleMouseUp, handleClick, handleDoubleClick };
}

/** Hook: touch event handlers (two-finger pinch zoom + two-finger pan) */
function useTouchHandlers(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  viewport: Viewport,
  actions: FractalActions
) {
  const pinchDist = useRef(0);
  const pinchCenter = useRef({ x: 0, y: 0 });

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length >= 2 && t0 && t1) {
      e.preventDefault();
      pinchDist.current = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      pinchCenter.current = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length < 2) return;
    e.preventDefault();
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (!t0 || !t1) return;

    const cx = (t0.clientX + t1.clientX) / 2;
    const cy = (t0.clientY + t1.clientY) / 2;
    const dims = getCanvasDims(canvasRef.current);
    if (!dims.rect) return;

    // Two-finger pan
    const ar = dims.width / dims.height;
    const dx = (cx - pinchCenter.current.x) / dims.rect.width * viewport.scale * ar;
    const dy = (cy - pinchCenter.current.y) / dims.rect.height * viewport.scale;
    actions.pan(-dx, -dy);

    // Pinch zoom around midpoint (normalized pixel offset for deep precision)
    const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    if (pinchDist.current > 0 && dist > 0) {
      const pos = toCanvasCoords(cx, cy, dims);
      const nxOff = dims.width > 0 ? pos.x / dims.width - 0.5 : 0;
      const nyOff = dims.height > 0 ? pos.y / dims.height - 0.5 : 0;
      actions.zoom(pinchDist.current / dist, nxOff, nyOff, ar);
    }

    pinchDist.current = dist;
    pinchCenter.current = { x: cx, y: cy };
  }, [canvasRef, viewport, actions]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length >= 2 && t0 && t1) {
      pinchDist.current = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      pinchCenter.current = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
    }
  }, []);

  return { handleTouchStart, handleTouchMove, handleTouchEnd };
}

/** Hook: keyboard shortcuts */
function useKeyboardHandler(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  isPickingJulia: boolean,
  actions: FractalActions,
  onEscapeCancel?: () => void,
  onFindNucleus?: () => void
) {
  return useCallback((e: KeyboardEvent) => {
    if (e.key === 'r' || e.key === 'R') {
      actions.reset();
    } else if (e.key === 'n' || e.key === 'N') {
      onFindNucleus?.();
    } else if (e.key === 'Escape') {
      if (isPickingJulia) {
        actions.setPickingJulia(false);
      }
      onEscapeCancel?.();
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      const dims = getCanvasDims(canvasRef.current);
      const ar = dims.width / (dims.height || 1);
      // Center zoom: nxOff=0, nyOff=0
      actions.zoom(e.key === '-' ? 1.4 : 0.7, 0, 0, ar);
    }
  }, [canvasRef, actions, isPickingJulia, onEscapeCancel, onFindNucleus]);
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
  onJuliaPick,
  onEscapeCancel,
  onFindNucleus
}: UseCanvasEventsOptions) {
  const mouse = useMouseHandlers(canvasRef, viewport, isPickingJulia, actions, onJuliaPick);
  const touch = useTouchHandlers(canvasRef, viewport, actions);
  const handleKeyDown = useKeyboardHandler(canvasRef, isPickingJulia, actions, onEscapeCancel, onFindNucleus);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('wheel', mouse.handleWheel, { passive: false });
    canvas.addEventListener('mousedown', mouse.handleMouseDown);
    canvas.addEventListener('click', mouse.handleClick);
    canvas.addEventListener('dblclick', mouse.handleDoubleClick);
    canvas.addEventListener('touchstart', touch.handleTouchStart, { passive: false });
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
