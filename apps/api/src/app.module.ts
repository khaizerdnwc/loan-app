import { dataSourceOptions, LendingModule, Public, SessionGuard } from "@loan/base";
import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SimulatedProvidersModule } from "./adapters/simulated/simulated-providers.module";
import { env } from "./config/env";

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
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),
    SimulatedProvidersModule,
    LendingModule.register({
      jwtSecret: env().JWT_SECRET,
      cookieSecure: env().NODE_ENV === "production",
    }),
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: SessionGuard },
  ],
})
export class AppModule {}
