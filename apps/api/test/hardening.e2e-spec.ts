import { SEED_TEST_PASSWORD, SIGN_IN_LIMITS } from "@loan/base";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "../src/app";
import { AppModule } from "../src/app.module";
import { type Harness, type Persona, STAFF, startHarness } from "./support/harness";

/** The default throttler's limit per route and minute (app.module.ts). */
const DEFAULT_LIMIT = 300;

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

describe("Swagger is an explicit opt-in (H1)", () => {
  it("with SWAGGER_ENABLED unset, the app serves neither the UI nor the OpenAPI document", async () => {
    const server = h.app.getHttpServer();
    await request(server).get("/docs").expect(404);
    await request(server).get("/docs-json").expect(404);
  });

  it("an app configured with swagger on serves the document (control)", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app, { swagger: true });
    await app.init();
    try {
      const res = await request(app.getHttpServer()).get("/docs-json").expect(200);
      expect(res.body.info.title).toBe("WhiteBank Lending API (MVP)");
    } finally {
      await app.close();
    }
  });
});

describe("per-user throttling behind one address (H3)", () => {
  const me = (persona: Persona) => h.as(persona).get("/auth/me");

  it("each signed-in user has their own bucket: one user's 301st request is refused, another user's is not", async () => {
    for (let i = 0; i < DEFAULT_LIMIT; i++) await me("diane").expect(200);
    const limited = await me("diane").expect(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    // Same address, different staff member: still served.
    expect((await me("lito").expect(200)).body.id).toBe(STAFF.lito);
  }, 60_000);

  it("forged or garbage tokens count against the caller's address, and do not lock out signed-in staff", async () => {
    const forger = new JwtService({ secret: "not-the-api-secret-but-32-characters-long" });
    const server = h.app.getHttpServer();
    for (let i = 0; i < DEFAULT_LIMIT; i++) {
      const token =
        i % 2 === 0 ? `garbage-${i}` : await forger.signAsync({ sub: `${STAFF.ella}-${i}` });
      await request(server).get("/auth/me").set("Authorization", `Bearer ${token}`).expect(401);
    }
    // The address bucket is spent: an anonymous caller and a fresh forgery are refused...
    const anonymous = await request(server).get("/auth/me").expect(429);
    expect(anonymous.body.code).toBe("RATE_LIMITED");
    const forged = await forger.signAsync({ sub: STAFF.ella });
    await request(server).get("/auth/me").set("Authorization", `Bearer ${forged}`).expect(429);
    // ...while a real session from the same address is not.
    expect((await me("ella").expect(200)).body.id).toBe(STAFF.ella);
  }, 60_000);
});

describe("behind the backoffice, sign-in is limited per client address (H8)", () => {
  // Its own app, trusting one hop (the backoffice), with fresh throttle counters.
  it("two clients behind the proxy get separate sign-in budgets, and a client-written entry splits nothing", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app, { trustProxyHops: 1 });
    await app.init();
    try {
      const signIn = (xff: string, i: number) =>
        request(app.getHttpServer())
          .post("/auth/sign-in")
          .set("X-Forwarded-For", xff)
          .send({ username: `spray-${i}`, password: "guess" });
      // Client A uses up its budget (distinct usernames: only the per-source cap applies).
      for (let i = 0; i < SIGN_IN_LIMITS.perSource; i++) {
        await signIn("198.51.100.1", i).expect(401);
      }
      const limited = await signIn("198.51.100.1", 999).expect(429);
      expect(limited.body.code).toBe("RATE_LIMITED");
      // Client B, through the same proxy, is not affected.
      const other = await signIn("198.51.100.2", 1000).expect(401);
      expect(other.body.code).toBe("UNAUTHENTICATED");
      // Client A writing its own entry first: the API still takes the backoffice's (rightmost).
      await signIn("203.0.113.50, 198.51.100.1", 1001).expect(429);
    } finally {
      await app.close();
    }
  }, 60_000);

  /** Its own app trusting one hop, with fresh counters; `run` gets a sign-in helper. */
  async function behindProxy(
    run: (
      signIn: (xff: string, username: string, password?: string) => request.Test,
    ) => Promise<void>,
  ): Promise<void> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app, { trustProxyHops: 1 });
    await app.init();
    try {
      await run((xff, username, password = "guess") =>
        request(app.getHttpServer())
          .post("/auth/sign-in")
          .set("X-Forwarded-For", xff)
          .send({ username, password }),
      );
    } finally {
      await app.close();
    }
  }

  it("guesses on one account from many addresses are still capped (per account, all sources)", async () => {
    await behindProxy(async (signIn) => {
      for (let i = 1; i <= SIGN_IN_LIMITS.perAccountGlobal; i++) {
        await signIn(`198.51.100.${i}`, "target").expect(401);
      }
      const limited = await signIn("203.0.113.200", "target").expect(429);
      expect(limited.body.code).toBe("RATE_LIMITED");
    });
  }, 60_000);

  it("addresses rotating inside one IPv6 /64 count as one source for one account", async () => {
    await behindProxy(async (signIn) => {
      for (let i = 1; i <= SIGN_IN_LIMITS.perAccount; i++) {
        await signIn(`2001:db8:1:2::${i.toString(16)}`, "target6").expect(401);
      }
      const limited = await signIn("2001:db8:1:2:ffff::1", "target6").expect(429);
      expect(limited.body.code).toBe("RATE_LIMITED");
    });
  }, 60_000);

  it("the accepted trade-off: once an account's all-sources cap is hit, even its right password gets 429 and no session", async () => {
    await behindProxy(async (signIn) => {
      for (let i = 1; i <= SIGN_IN_LIMITS.perAccountGlobal; i++) {
        await signIn(`198.51.100.${i}`, "rina").expect(401);
      }
      // The real owner, from an address that has not been used, with the right password.
      const refused = await signIn("203.0.113.77", "rina", SEED_TEST_PASSWORD).expect(429);
      expect(refused.body.code).toBe("RATE_LIMITED");
      expect(refused.headers["set-cookie"]).toBeUndefined();
    });
  }, 60_000);

  // A regression guard for the throttler library's own normalisation (its default tracker
  // already counts IPv6 per /64), not proof of this change: it passed before H8 round 2 too.
  it("distinct usernames from addresses rotating inside one /64 reach the per-source cap", async () => {
    await behindProxy(async (signIn) => {
      for (let i = 1; i <= SIGN_IN_LIMITS.perSource; i++) {
        await signIn(`2001:db8:9:9::${i.toString(16)}`, `spray6-${i}`).expect(401);
      }
      const limited = await signIn("2001:db8:9:9:abcd::1", "spray6-last").expect(429);
      expect(limited.body.code).toBe("RATE_LIMITED");
    });
  }, 60_000);
});

describe("sign-in stays per address (last: it uses up this address's sign-in budget)", () => {
  it("holding a valid session does not split the per-source sign-in cap", async () => {
    // The harness signed every persona in from this address; nothing else here signs in.
    // Alternating two personas' session cookies, the address's budget is used up exactly at
    // the cap. Keyed per user, each persona would get its own budget and none would be refused.
    const remaining = SIGN_IN_LIMITS.perSource - Object.keys(STAFF).length;
    const spray = (i: number) =>
      h
        .as(i % 2 === 0 ? "rina" : "ben")
        .post("/auth/sign-in", { username: `spray-${i}`, password: "guess" });
    for (let i = 0; i < remaining; i++) await spray(i).expect(401);
    const limited = await spray(remaining).expect(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
  });
});
