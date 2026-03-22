/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Actions Section
 * Reset and export action buttons
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from 'react';
import { Button } from '@/components/ui/button';

interface ActionsSectionProps {
  onReset: () => void;
  onExport: () => void;
}

export const ActionsSection: React.FC<ActionsSectionProps> = ({ onReset, onExport }) => (
  <div className="flex gap-2">
    <Button onClick={onReset} aria-label="Réinitialiser la vue" className="flex-1">
      🔄 Reset
    </Button>
    <Button onClick={onExport} aria-label="Exporter en PNG" variant="outline" className="flex-1">
      📷 Export
    </Button>
  </div>
);
