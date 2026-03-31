import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

// Next.js 16 dev mode requires unsafe-eval for callstack reconstruction.
// Production builds never use eval().
const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
  : "'self' 'unsafe-inline' 'wasm-unsafe-eval'";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Content-Security-Policy', value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'` },
        ],
      },
    ];
  },
};

export default nextConfig;
