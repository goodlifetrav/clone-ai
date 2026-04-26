import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Playwright and other native modules must run in Node.js, not Edge runtime
  serverExternalPackages: ['playwright', 'playwright-core'],

  // Allow images from any HTTPS source (for thumbnails/screenshots)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },

  // TypeScript strict checking during builds
  typescript: {
    ignoreBuildErrors: false,
  },

  // Fix workspace root detection for Turbopack
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
