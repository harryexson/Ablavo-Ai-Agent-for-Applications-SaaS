// Local env files (production platforms inject real environment variables instead).
for (const f of [".env", ".env.demo"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* optional */
  }
}
import { createDatabase } from "@ablavo/database";
import { loadConfig } from "./config";
import { buildApp } from "./app";
import { startScheduler } from "./worker";

const config = loadConfig();
const handle = await createDatabase(config.databaseUrl);
const { app, ctx } = await buildApp(config, handle.db);

const role = process.env.PROCESS_ROLE ?? "all"; // all | api | worker
if (role !== "api") {
  ctx.queue.start();
  startScheduler(ctx);
}
if (role !== "worker") {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API ready on ${config.publicApiUrl} (db: ${handle.driver}, queue: ${ctx.queue.kind}, storage: ${ctx.storage.kind})`);
}

const shutdown = async () => {
  await app.close();
  await ctx.queue.stop();
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
