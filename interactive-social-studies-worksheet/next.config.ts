import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // لا نضع distDir يدوياً لأن Vercel يدير مسار البناء (.vercel/output) تلقائياً
  headers: async () => [
    {
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        { key: "Pragma", value: "no-cache" },
      ],
    },
  ],
};

export default nextConfig;
