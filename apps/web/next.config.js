/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverRuntimeConfig: {
    port: 3001
  }
};

process.env.PORT = '3001';

module.exports = nextConfig;
