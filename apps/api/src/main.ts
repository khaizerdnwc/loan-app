import { Logger } from "@nestjs/common";
import { createApp } from "./app";
import { env } from "./config/env";

async function bootstrap(): Promise<void> {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(env().PORT, "0.0.0.0");
  new Logger("bootstrap").log(`API listening on :${env().PORT} (Swagger at /docs)`);
}

bootstrap().catch((err: unknown) => {
  new Logger("bootstrap").error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
