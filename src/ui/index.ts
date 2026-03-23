/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UI LAYER - Public API
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Components
export { ControlsPanel } from './ControlsPanel';
export { InfoPanel } from './InfoPanel';
export { HelpTooltip } from './HelpTooltip';
export { LoadingOverlay } from './LoadingOverlay';

// Sub-sections (for advanced usage / testing)
export { FractalTypeSection, JuliaSection, AppearanceSection, ColoringSection, ActionsSection } from './controls';

// Themes
export { getThemeLabel, getThemeNames, THEME_NAMES } from './themes';
