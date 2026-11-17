import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

const workspaceEnv = resolve("..", ".env");
if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:4000";

const config: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/:path*` }];
  },
};

export default config;
