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
