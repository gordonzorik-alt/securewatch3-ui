import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '4000',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: '136.119.129.106',
        port: '4000',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: '136.119.129.106',
        port: '9000',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
