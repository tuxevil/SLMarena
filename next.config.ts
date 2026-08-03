import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const localDevOrigins = Object.values(networkInterfaces())
  .flatMap((interfaces) => interfaces ?? [])
  .filter((address) => address.family === "IPv4" || address.family === 4)
  .map((address) => address.address);
const configuredDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  typedRoutes: true,
  allowedDevOrigins: ["localhost", "127.0.0.1", ...localDevOrigins, ...configuredDevOrigins],
};

export default nextConfig;
