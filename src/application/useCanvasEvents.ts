/**
 * ═══════════════════════════════════════════════════════════════════════════
 * APPLICATION LAYER - Canvas Event Handling
 * Mouse, touch, and keyboard event management
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Viewport, FractalType } from '../domain';
import { screenToComplex } from '../domain';
import type { FractalActions } from './useFractalState';

interface UseCanvasEventsOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewport: Viewport;
  fractalType: FractalType;
  isPickingJulia: boolean;
  actions: FractalActions;
  onJuliaPick?: (re: number, im: number) => void;
}

/**
 * Custom hook for handling all canvas interactions
 */
export function useCanvasEvents({
  canvasRef,
  viewport,
  fractalType,
  isPickingJulia,
  actions,
  onJuliaPick
}: UseCanvasEventsOptions) {
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const touchDistance = useRef(0);

  const getCanvasDimensions = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { width: 0, height: 0, rect: null };
    return {
      width: canvas.width,
      height: canvas.height,
      rect: canvas.getBoundingClientRect()
    };
  }, [canvasRef]);

  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const { width, height, rect } = getCanvasDimensions();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) * (width / rect.width),
      y: (clientY - rect.top) * (height / rect.height)
    };
  }, [getCanvasDimensions]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const { width, height } = getCanvasDimensions();
    const pos = clientToCanvas(e.clientX, e.clientY);
    const c = screenToComplex(pos.x, pos.y, width, height, viewport);
    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
    actions.zoom(zoomFactor, c.re, c.im);
  }, [getCanvasDimensions, clientToCanvas, viewport, actions]);

  // Mouse down
  const handleMouseDown = useCallback((e: MouseEvent) => {
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = 'grabbing';
  }, [canvasRef]);

  // Mouse move
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const { width, height, rect } = getCanvasDimensions();
    if (!rect) return;

    const aspectRatio = width / height;
    const deltaX = (e.clientX - lastPos.current.x) / rect.width * viewport.scale * aspectRatio;
    const deltaY = (e.clientY - lastPos.current.y) / rect.height * viewport.scale;

    actions.pan(-deltaX, -deltaY);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [getCanvasDimensions, viewport, actions]);

  // Mouse up
  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = 'crosshair';
  }, [canvasRef]);

  // Click (for Julia picking)
  const handleClick = useCallback((e: MouseEvent) => {
    if (!isPickingJulia || !onJuliaPick) return;
    
    const { width, height } = getCanvasDimensions();
    const pos = clientToCanvas(e.clientX, e.clientY);
    const c = screenToComplex(pos.x, pos.y, width, height, viewport);
    
    onJuliaPick(c.re, c.im);
  }, [isPickingJulia, onJuliaPick, getCanvasDimensions, clientToCanvas, viewport]);

  // Double click
  const handleDoubleClick = useCallback((e: MouseEvent) => {
    if (isPickingJulia) return;
    
    const { width, height } = getCanvasDimensions();
    const pos = clientToCanvas(e.clientX, e.clientY);
    const c = screenToComplex(pos.x, pos.y, width, height, viewport);
    actions.zoom(0.5, c.re, c.im);
  }, [isPickingJulia, getCanvasDimensions, clientToCanvas, viewport, actions]);

  // Touch events
  const handleTouchStart = useCallback((e: TouchEvent) => {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 1 && t0) {
      isDragging.current = true;
      lastPos.current = { x: t0.clientX, y: t0.clientY };
    } else if (e.touches.length === 2 && t0 && t1) {
      isDragging.current = false;
      touchDistance.current = Math.hypot(
        t0.clientX - t1.clientX,
        t0.clientY - t1.clientY
      );
    }
  }, [viewport]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();

    const t0 = e.touches[0];
    const t1 = e.touches[1];
    if (e.touches.length === 1 && isDragging.current && t0) {
      const { width, height, rect } = getCanvasDimensions();
      if (!rect) return;

      const aspectRatio = width / height;
      const deltaX = (t0.clientX - lastPos.current.x) / rect.width * viewport.scale * aspectRatio;
      const deltaY = (t0.clientY - lastPos.current.y) / rect.height * viewport.scale;

      actions.pan(-deltaX, -deltaY);
      lastPos.current = { x: t0.clientX, y: t0.clientY };
    } else if (e.touches.length === 2 && t0 && t1) {
      const distance = Math.hypot(
        t0.clientX - t1.clientX,
        t0.clientY - t1.clientY
      );

      const centerX = (t0.clientX + t1.clientX) / 2;
      const centerY = (t0.clientY + t1.clientY) / 2;
      
      const { width, height } = getCanvasDimensions();
      const pos = clientToCanvas(centerX, centerY);
      const c = screenToComplex(pos.x, pos.y, width, height, viewport);
      
      const factor = touchDistance.current / distance;
      actions.zoom(factor, c.re, c.im);
      touchDistance.current = distance;
    }
  }, [getCanvasDimensions, clientToCanvas, viewport, actions]);

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Keyboard
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'r' || e.key === 'R') {
      actions.reset();
    } else if (e.key === 'Escape' && isPickingJulia) {
      actions.setPickingJulia(false);
    } else if (e.key === '+' || e.key === '=') {
      const { width, height } = getCanvasDimensions();
      const c = screenToComplex(width / 2, height / 2, width, height, viewport);
      actions.zoom(0.8, c.re, c.im);
    } else if (e.key === '-') {
      const { width, height } = getCanvasDimensions();
      const c = screenToComplex(width / 2, height / 2, width, height, viewport);
      actions.zoom(1.2, c.re, c.im);
    }
  }, [getCanvasDimensions, viewport, actions, isPickingJulia]);

  // Attach event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('dblclick', handleDoubleClick);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    canvasRef,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleClick,
    handleDoubleClick,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleKeyDown
  ]);
}
