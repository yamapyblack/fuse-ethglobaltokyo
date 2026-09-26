import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // web/ をルートに固定する。上位ディレクトリの pnpm-lock.yaml を拾わせない
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  // R2の画像はそのまま<img>で出すので next/image の最適化は使わない
};

export default nextConfig;
