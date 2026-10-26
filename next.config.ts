import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The transformers.js pipeline is bundled into the server output; its
  // dynamic internal require of onnxruntime-node resolves from node_modules
  // in the image, so these two (not transformers itself) are the externals.
  serverExternalPackages: ["better-sqlite3", "pg"],
};

export default nextConfig;
