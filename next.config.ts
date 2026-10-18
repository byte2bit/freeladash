import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["node:sqlite", "bcryptjs"],
  outputFileTracingIncludes: { "/*": ["./node_modules/bcryptjs/**/*"] },
};
export default config;
