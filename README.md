# 🌀 Fractal Explorer

Un explorateur de fractales multi-ensembles interactif avec architecture DDD/SRP propre.

## 🎯 Fractales disponibles

| Fractale | Formule | Description |
|----------|---------|-------------|
| **Mandelbrot** | z → z² + c | L'ensemble classique |
| **Julia** | z → z² + c (c fixe) | Cliquez sur Mandelbrot pour choisir c ! |
| **Burning Ship** | z → (\|Re(z)\| + i\|Im(z)\|)² + c | Navire en feu (1992) |
| **Tricorn** | z → conj(z)² + c | Utilise le conjugué complexe |
| **Multibrot 3** | z → z³ + c | Symétrie ternaire |
| **Multibrot 4** | z → z⁴ + c | Symétrie quaternaire |
| **Multibrot 5** | z → z⁵ + c | Symétrie pentagonale |

## ✨ Fonctionnalité magique : Julia Picker

1. Sélectionnez "Julia" dans le menu
2. Cliquez sur "🎯 Choisir sur Mandelbrot"
3. Cliquez n'importe où sur l'ensemble de Mandelbrot
4. L'ensemble de Julia correspondant à ce point s'affiche !

Chaque point du Mandelbrot génère un Julia unique — explorez !

## 📦 Structure

```
fractal-explorer/
├── standalone/
│   └── fractal-explorer.html   # Version HTML (zéro dépendance)
└── react/src/
    ├── domain/                  # Logique pure
    │   ├── types.ts
    │   ├── fractals.ts         # Calculateurs
    │   ├── fractalTypes.ts     # Configurations
    │   ├── palettes.ts
    │   └── coordinates.ts
    ├── application/            # State & Events
    │   ├── useFractalState.ts
    │   └── useCanvasEvents.ts
    ├── infrastructure/         # Rendu Canvas
    │   ├── renderer.ts
    │   └── useRenderer.ts
    ├── ui/                     # Composants React
    │   ├── themes.ts
    │   ├── ControlsPanel.tsx
    │   └── components.tsx
    └── FractalExplorer.tsx     # Composant principal
```

## 🚀 Utilisation

### HTML Standalone

```html
<iframe src="fractal-explorer.html" style="width: 100%; height: 100vh;"></iframe>
```

### React/Next.js

```tsx
import { FractalExplorer } from '@/components/fractal-explorer';

export default function Page() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <FractalExplorer 
        initialFractalType="mandelbrot"
        initialTheme="miami"
        initialPalette="neon"
      />
    </div>
  );
}
```

## ⚙️ Props

```tsx
interface FractalExplorerProps {
  initialFractalType?: FractalType;  // 'mandelbrot' | 'julia' | ...
  initialTheme?: ThemeName;           // 'default' | 'miami' | 'ocean' | 'light'
  initialPalette?: PaletteName;       // 'classic' | 'fire' | 'miami' | ...
  initialIterations?: number;         // 50-1000
  showControls?: boolean;
  showInfo?: boolean;
  showHelp?: boolean;
  onThemeChange?: (theme: ThemeName) => void;
}
```

## 🎨 Palettes

9 palettes incluses :
- Classic, Fire, Ice, Neon, Grayscale
- Psychedelic, Sunset, Miami, Electric

## 🎮 Contrôles

- **Molette** : Zoom
- **Glisser** : Déplacer
- **Double-clic** : Zoom + centrer
- **R** : Reset
- **+/-** : Zoom clavier
- **Échap** : Annuler sélection Julia

## 📱 Touch Support

- Pinch to zoom
- Drag to pan
- Double-tap to zoom in

---

Créé pour être ajouté comme Easter Egg dans vos applications ! 🥚
