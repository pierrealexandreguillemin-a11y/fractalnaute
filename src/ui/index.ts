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
export { FractalTypeSection, JuliaSection, AppearanceSection, ActionsSection } from './controls';

// Styles
export { glassBaseStyle, dividerStyle, labelStyle, selectStyle, monoFontFamily, buttonStyle, infoBoxStyle, radius, zIndex, BG_SECONDARY, BORDER_COLOR, BORDER_SOLID } from './styles';

// Themes
export {
  themes,
  getThemeCSSVariables,
  getThemeLabel,
  getThemeNames,
  keyframesCSS
} from './themes';

export type { ThemeColors } from './themes';
