import { SIGN_IN_LIMITS } from "@loan/base";
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
