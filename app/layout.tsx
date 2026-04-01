import type { Metadata } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fractalnaute',
  description: 'GPU-accelerated fractal explorer — WebGL 2, 5 fractals × 5 coloring modes, deep zoom to 10⁻¹⁵',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="h-screen w-screen">{children}<SpeedInsights /></body>
    </html>
  );
}
