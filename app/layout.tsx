import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fractal Explorer',
  description: 'Multi-fractal interactive explorer with OKLCH color space',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="h-screen w-screen">{children}</body>
    </html>
  );
}
