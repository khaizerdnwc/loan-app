import "reflect-metadata";
import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { env } from "./config/env";
import { ProblemFilter } from "./problem.filter";

/** Build the configured app (used by main.ts and by the integration tests). */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  configureApp(app);
  return app;
}

export interface AppOptions {
  /**
   * Serve the Swagger UI at /docs and the OpenAPI document at /docs-json. Defaults to
   * SWAGGER_ENABLED, which is off unless set to "true" (local development's .env.example).
   */
  swagger?: boolean;
  /** Proxies whose X-Forwarded-For entry is believed (default TRUST_PROXY_HOPS). */
  trustProxyHops?: number;
}

export function configureApp(
  app: INestApplication,
  { swagger = env().SWAGGER_ENABLED, trustProxyHops = env().TRUST_PROXY_HOPS }: AppOptions = {},
): void {
  // Trust X-Forwarded-For only from the configured number of proxies (default none), so a
  // client cannot pick its own throttle bucket by sending the header itself. Deployed behind
  // the backoffice, 1: the backoffice passes on the client address alone (docs/DEPLOY.md).
  (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set(
    "trust proxy",
    trustProxyHops,
  );
  app.use(cookieParser());
  app.enableCors({ origin: env().CORS_ORIGIN, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ProblemFilter());
  if (!swagger) return;
  const doc = new DocumentBuilder()
    .setTitle("WhiteBank Lending API (MVP)")
    .setDescription(
      "Personal loan from application to booking. Every external service is simulated. See docs/API.md.",
    )
    .addCookieAuth("session")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, doc));
}
