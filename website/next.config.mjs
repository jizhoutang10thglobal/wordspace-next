/** @type {import('next').NextConfig} */

// Stable download short-links. Both point at the "latest" GitHub release
// of the app, so the URLs never change across versions. Artifact names
// match electron-builder's `build.mac/win.artifactName` in the app's
// package.json — keep them in sync if those change.
const RELEASE_BASE =
  'https://github.com/jizhoutang10thglobal/wordspace-next/releases/latest/download';

const nextConfig = {
  reactStrictMode: true,

  async redirects() {
    return [
      {
        source: '/downloads/mac',
        destination: `${RELEASE_BASE}/wordspace-next-mac-arm64.dmg`,
        statusCode: 302,
      },
      {
        source: '/downloads/mac-intel',
        destination: `${RELEASE_BASE}/wordspace-next-mac-x64.dmg`,
        statusCode: 302,
      },
      {
        source: '/downloads/win',
        destination: `${RELEASE_BASE}/wordspace-next-win-x64.exe`,
        statusCode: 302,
      },
    ];
  },
};

export default nextConfig;
