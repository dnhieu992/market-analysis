const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverRuntimeConfig: {
    port: 3001
  },
  async redirects() {
    return [
      // /portfolio-pnl merged into the P&L hub. Done here rather than with a
      // redirect() page: that route prerenders static, and a build-time
      // redirect() is baked as an error page instead of an HTTP redirect.
      // 307 not 308 — browsers cache a permanent redirect forever, which is a
      // bad trade on an auth-gated dashboard with no SEO to gain.
      {
        source: '/portfolio-pnl',
        destination: '/pnl-calendar?tab=portfolio',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
    return [
      {
        source: '/api-proxy/:path*',
        destination: `${apiBase}/:path*`,
      },
    ];
  },
};

process.env.PORT = '3001';

module.exports = withPWA(nextConfig);
