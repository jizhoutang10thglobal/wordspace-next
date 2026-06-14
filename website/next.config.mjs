/** @type {import('next').NextConfig} */

const MIRROR_BASE =
  'https://github.com/jizhoutang10thglobal/wordspace-releases/releases/latest/download';

const nextConfig = {
  reactStrictMode: true,

  async redirects() {
    return [
      {
        source: '/downloads/mac',
        destination: `${MIRROR_BASE}/wordspace-mac-arm64.dmg`,
        statusCode: 302,
      },
      {
        source: '/downloads/win',
        destination: `${MIRROR_BASE}/wordspace-windows-setup.exe`,
        statusCode: 302,
      },
    ];
  },
};

export default nextConfig;
