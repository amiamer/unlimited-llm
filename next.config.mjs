/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native and server-only modules for the local terminal: load them from
    // node_modules at runtime instead of bundling them.
    serverComponentsExternalPackages: ['node-pty', 'ws'],
  },
  eslint: {
    // Lint errors now fixed — fail build on new lint errors
    ignoreDuringBuilds: false,
  },
  typescript: {
    // TypeScript errors now fixed — fail build on new type errors
    ignoreBuildErrors: false,
  },
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://img.clerk.com https://wikimedia.org https://*.wikimedia.org https://upload.wikimedia.org https://iep.utm.edu https://plato.stanford.edu; font-src 'self' data:; connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com https://en.wikipedia.org ws://127.0.0.1:*; frame-src 'self' https://*.clerk.accounts.dev; worker-src 'self' blob:; media-src 'self' blob:;"
          }
        ],
      },
    ];
  },
};

export default nextConfig;
