import type { Metadata } from 'next';
import './globals.css';

// eslint-disable-next-line react-refresh/only-export-components -- Next.js App Router convention: metadata must be a named export alongside the layout component
export const metadata: Metadata = {
  title: 'Fractal Explorer',
  description: 'Multi-fractal interactive explorer with OKLCH color space',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
