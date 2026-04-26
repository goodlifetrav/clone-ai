import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Standalone output bundles only what's needed — ideal for VPS deployment
  output: 'standalone',

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
}

export default nextConfig
