import { createApp } from "./app.js";

async function main() {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 4000), process.env.API_HOST ?? "127.0.0.1");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "API startup failed.");
  process.exitCode = 1;
});
