import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Standalone output bundles only what's needed — ideal for VPS deployment
  output: 'standalone',

  // Playwright and other native modules must run in Node.js, not Edge runtime
  serverExternalPackages: ['playwright', 'playwright-core', 'geoip-lite'],

  // Restrict the /_next/image optimizer to known hosts. Previously this was
  // hostname: '**' which made our server an open image proxy for any HTTPS
  // URL — SSRF + bandwidth amplification surface via /_next/image?url=...
  // Nothing in the app currently uses the next/image component, but the
  // optimizer endpoint is still publicly reachable, so we lock it down.
  images: {
    remotePatterns: [
      // Cloudflare R2 (rehosted clone assets + screenshots)
      { protocol: 'https', hostname: 'pub-c9773f5247f44f3ebd4e17a5dcfae22e.r2.dev' },
      // Supabase storage (user-uploaded images via /api/projects/[id]/upload-image)
      { protocol: 'https', hostname: 'lpcaqiwhyiozqeqcsaux.supabase.co' },
    ],
  },

  // TypeScript strict checking during builds
  typescript: {
    ignoreBuildErrors: false,
  },
}

export default nextConfig
