/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - LoadingOverlay
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface LoadingOverlayProps {
  isVisible: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isVisible }) => (
  <div
    className={cn(
      'absolute inset-0 z-50 flex items-center justify-center',
      'bg-overlay transition-opacity duration-300',
      isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
    )}
  >
    <div
      className="w-12 h-12 border-3 border-border border-t-primary rounded-full animate-[fractal-spin_0.8s_linear_infinite]"
    />
  </div>
);
