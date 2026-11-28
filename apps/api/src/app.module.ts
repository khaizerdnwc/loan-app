import {
  dataSourceOptions,
  LendingModule,
  openDataSource,
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
import { ExpirySweep } from "./expiry-sweep";
import { NotificationSweep } from "./notification-sweep";
import { signInAccountGlobalTracker, signInAccountTracker } from "./sign-in-trackers";
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
 * that fails closed on every route that does not declare @Roles or @Public. The expiry
 * sweep's timer lives here too, so the domain has no scheduler of its own.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => dataSourceOptions(env().DATABASE_URL),
      // MIGRATE_ON_BOOT migrates under a Postgres advisory lock, so replicas can start together.
      dataSourceFactory: async (options) => {
        if (!options) throw new Error("unreachable: useFactory always returns options");
        return openDataSource(options, env().MIGRATE_ON_BOOT, {
          timeoutMs: env().MIGRATION_LOCK_TIMEOUT_MS,
        });
      },
    }),
    ThrottlerModule.forRoot([
      // Every route: per signed-in staff member, else per caller address (throttler.guard.ts).
      { name: "default", ttl: 60_000, limit: 300 },
      // Sign-in only (@SignInRoute), per address (IPv6 /64) + username: one person's typos
      // do not lock out the others sharing an address.
      {
        name: "signInAccount",
        ttl: SIGN_IN_LIMITS.ttlMs,
        limit: SIGN_IN_LIMITS.perAccount,
        skipIf: (ctx) => Reflect.getMetadata(SIGN_IN_KEY, ctx.getHandler()) !== true,
        getTracker: (req) => signInAccountTracker(req),
      },
      // Sign-in only, per username from every address together: guessing one account's
      // password is capped however many addresses the guesses come from.
      {
        name: "signInAccountGlobal",
        ttl: SIGN_IN_LIMITS.ttlMs,
        limit: SIGN_IN_LIMITS.perAccountGlobal,
        skipIf: (ctx) => Reflect.getMetadata(SIGN_IN_KEY, ctx.getHandler()) !== true,
        getTracker: (req) => signInAccountGlobalTracker(req),
      },
    ]),
    SimulatedProvidersModule,
    LendingModule.register({
      jwtSecret: env().JWT_SECRET,
      cookieSecure: env().NODE_ENV === "production",
      resilience: {
        retryAttempts: env().PROVIDER_RETRY_ATTEMPTS,
        retryBaseMs: env().PROVIDER_RETRY_BASE_MS,
        circuitThreshold: env().PROVIDER_CIRCUIT_THRESHOLD,
        circuitOpenMs: env().PROVIDER_CIRCUIT_OPEN_MS,
        bureauCacheDays: env().BUREAU_CACHE_DAYS,
      },
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionThrottlerGuard },
    { provide: APP_GUARD, useExisting: SessionGuard },
    ExpirySweep,
    NotificationSweep,
  ],
})
export class AppModule {}
