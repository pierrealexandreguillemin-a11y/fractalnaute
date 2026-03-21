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
export { Kbd } from './Kbd';

// Sub-sections (for advanced usage / testing)
export { FractalTypeSection } from './controls/FractalTypeSection';
export { JuliaSection } from './controls/JuliaSection';
export { AppearanceSection } from './controls/AppearanceSection';
export { ActionsSection } from './controls/ActionsSection';

// Styles
export { glassBaseStyle, dividerStyle, labelStyle, selectStyle } from './styles';

// Themes
export {
  themes,
  getThemeCSSVariables,
  getThemeLabel,
  getThemeNames,
  keyframesCSS
} from './themes';

export type { ThemeColors } from './themes';
