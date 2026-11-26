import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: { useTypeScriptCli: false },
  poweredByHeader: false,
  serverExternalPackages: ['sharp', '@xmldom/xmldom', '@img/colour'],
  outputFileTracingIncludes: {
    '/api/*': [
      './dist/**/*.js',
      './node_modules/sharp/**/*',
      './node_modules/@img/**/*',
      './node_modules/@xmldom/xmldom/**/*',
      './node_modules/detect-libc/**/*',
      './node_modules/semver/**/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default config;
