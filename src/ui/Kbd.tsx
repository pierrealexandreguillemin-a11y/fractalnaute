/**
 * ===================================================================
 * UI LAYER - Kbd
 * ===================================================================
 */

import React from 'react';

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-block px-1.5 py-0.5 bg-transparent border border-glass-border rounded-sm font-inherit text-[10px]">
    {children}
  </span>
);
