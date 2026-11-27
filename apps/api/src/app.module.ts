import {
  dataSourceOptions,
  LendingModule,
  Public,
  SessionGuard,
  SIGN_IN_KEY,
  SIGN_IN_LIMITS,
} from "@loan/base";
import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SimulatedProvidersModule } from "./adapters/simulated/simulated-providers.module";
import { env } from "./config/env";
import { SessionThrottlerGuard } from "./throttler.guard";

@Controller("health")
class HealthController {
  @Get()
  @Public()
  health(): { status: "ok" } {
    return { status: "ok" };
  }
}

/**
 * The composition root: the database, the simulated providers bound to the ports, the
 * lending domain, and the two global guards — throttling, then the session-and-roles guard
 * that fails closed on every route that does not declare @Roles or @Public.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => dataSourceOptions(env().DATABASE_URL, env().MIGRATE_ON_BOOT),
    }),
    ThrottlerModule.forRoot([
      // Every route: per signed-in staff member, else per caller address (throttler.guard.ts).
      { name: "default", ttl: 60_000, limit: 300 },
      // Sign-in only (@SignInRoute), per address + username: guessing one account's password
      // is capped, and one person's typos do not lock out the others behind the proxy.
      {
        name: "signInAccount",
        ttl: SIGN_IN_LIMITS.ttlMs,
        limit: SIGN_IN_LIMITS.perAccount,
        skipIf: (ctx) => Reflect.getMetadata(SIGN_IN_KEY, ctx.getHandler()) !== true,
        getTracker: (req) => {
          const username = (req as { body?: { username?: unknown } }).body?.username;
          const account =
            typeof username === "string" ? username.trim().toLowerCase().slice(0, 40) : "";
          return `${(req as { ip?: string }).ip ?? "unknown"}|${account}`;
        },
      },
    ]),
    SimulatedProvidersModule,
    LendingModule.register({
      jwtSecret: env().JWT_SECRET,
      cookieSecure: env().NODE_ENV === "production",
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionThrottlerGuard },
    { provide: APP_GUARD, useExisting: SessionGuard },
  ],
})
export class AppModule {}
