import type { FeatureFlagView, FeatureStateView } from "@loan/core";
import { count, type Harness, startHarness } from "./support/harness";

/**
 * Feature flags (PRD PLT-006): modules switched on or off for the bank by two administrators,
 * enforced by the modules' own services (FF-1..FF-4).
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await h.ds.query("TRUNCATE feature_flag_change");
  await h.ds.query("UPDATE feature_flag SET enabled = true, updated_by = NULL");
});

const PRE_CHECK = {
  amount: "150000.00",
  tenorMonths: 24,
  ageYears: 31,
  monthlyIncome: "78000.00",
  monthlyObligations: "9000.00",
};

const flags = async () =>
  (await h.as("leo").get("/features/flags").expect(200)).body as FeatureFlagView[];
const flag = async (key: string) => (await flags()).find((f) => f.key === key) as FeatureFlagView;
const audits = (action: string) =>
  count(h.ds, "SELECT count(*) AS n FROM audit_event WHERE action = $1", [action]);

/** Leo drafts, Celia approves: the flag switches. */
async function switchFlag(key: string, enabled: boolean): Promise<void> {
  const drafted = (
    await h
      .as("leo")
      .post(`/features/flags/${key}/changes`, { enabled, reason: "Test switch" })
      .expect(201)
  ).body as FeatureFlagView[];
  const id = drafted.find((f) => f.key === key)?.pendingChange?.id;
  await h.as("celia").post(`/features/flags/${key}/changes/${id}/approve`, {}).expect(200);
}

describe("FF-1 reading the flags", () => {
  it("every signed-in role reads which modules are on; only administrators list the flags", async () => {
    for (const persona of ["paolo", "rina", "marco", "diane", "leo"] as const) {
      const state = (await h.as(persona).get("/features").expect(200)).body as FeatureStateView;
      expect(state).toEqual({ ELIGIBILITY_PRECHECK: true, EMAIL_INTAKE: true });
    }
    const list = await flags();
    expect(list.map((f) => [f.key, f.enabled])).toEqual([
      ["ELIGIBILITY_PRECHECK", true],
      ["EMAIL_INTAKE", true],
    ]);
    for (const persona of ["paolo", "diane", "marco"] as const) {
      const res = await h.as(persona).get("/features/flags").expect(403);
      expect(res.body.code).toBe("FORBIDDEN_ROLE");
    }
  });
});

describe("FF-2 maker-checker on a change", () => {
  it("a change waits for a second administrator; the drafter cannot approve it; each step is audited in its transaction", async () => {
    const requested = await audits("FEATURE_FLAG_CHANGE_REQUESTED");
    const changed = await audits("FEATURE_FLAG_CHANGED");
    const drafted = (
      await h
        .as("leo")
        .post("/features/flags/EMAIL_INTAKE/changes", { enabled: false, reason: "Pilot paused" })
        .expect(201)
    ).body as FeatureFlagView[];
    const pending = drafted.find((f) => f.key === "EMAIL_INTAKE");
    expect(pending).toMatchObject({
      enabled: true,
      pendingChange: {
        enabled: false,
        reason: "Pilot paused",
        requestedByName: expect.any(String),
      },
      allowedActions: { request: false, approve: false, reject: true },
    });
    expect(await audits("FEATURE_FLAG_CHANGE_REQUESTED")).toBe(requested + 1);

    // The drafter approving their own change: refused, nothing changes.
    const id = pending?.pendingChange?.id as string;
    const own = await h
      .as("leo")
      .post(`/features/flags/EMAIL_INTAKE/changes/${id}/approve`, {})
      .expect(403);
    expect(own.body.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await flag("EMAIL_INTAKE")).enabled).toBe(true);
    expect(await audits("FEATURE_FLAG_CHANGED")).toBe(changed);

    // A second administrator approves: the module is off, and the step is audited.
    await h.as("celia").post(`/features/flags/EMAIL_INTAKE/changes/${id}/approve`, {}).expect(200);
    const after = await flag("EMAIL_INTAKE");
    expect(after).toMatchObject({ enabled: false, pendingChange: null });
    expect(after.updatedByName).not.toBeNull();
    expect(await audits("FEATURE_FLAG_CHANGED")).toBe(changed + 1);
    const [entry] = (await h.ds.query(
      "SELECT actor_id, details FROM audit_event WHERE action = 'FEATURE_FLAG_CHANGED' ORDER BY seq DESC LIMIT 1",
    )) as { actor_id: string; details: Record<string, unknown> }[];
    expect(entry).toMatchObject({
      actor_id: "STF-CELIA",
      details: { flag: "EMAIL_INTAKE", before: { enabled: true }, after: { enabled: false } },
    });
  });

  it("refuses a second draft while one waits, a draft to the current state, no reason, an unknown flag, and other roles", async () => {
    await h
      .as("leo")
      .post("/features/flags/EMAIL_INTAKE/changes", { enabled: false, reason: "First" })
      .expect(201);
    const second = await h
      .as("celia")
      .post("/features/flags/EMAIL_INTAKE/changes", { enabled: false, reason: "Second" })
      .expect(409);
    expect(second.body.code).toBe("INVALID_STATE_TRANSITION");
    const same = await h
      .as("leo")
      .post("/features/flags/ELIGIBILITY_PRECHECK/changes", { enabled: true, reason: "Already on" })
      .expect(400);
    expect(same.body.code).toBe("VALIDATION_FAILED");
    await h
      .as("leo")
      .post("/features/flags/ELIGIBILITY_PRECHECK/changes", { enabled: false, reason: "   " })
      .expect(400);
    await h
      .as("leo")
      .post("/features/flags/NO_SUCH_FLAG/changes", { enabled: false, reason: "x" })
      .expect(404);
    const officer = await h
      .as("paolo")
      .post("/features/flags/ELIGIBILITY_PRECHECK/changes", { enabled: false, reason: "x" })
      .expect(403);
    expect(officer.body.code).toBe("FORBIDDEN_ROLE");
    expect(await count(h.ds, "SELECT count(*) AS n FROM feature_flag_change")).toBe(1);
  });

  it("a rejected or withdrawn change leaves the flag as it was, and is audited", async () => {
    const draft = async () =>
      (
        (
          await h
            .as("leo")
            .post("/features/flags/ELIGIBILITY_PRECHECK/changes", { enabled: false, reason: "x" })
            .expect(201)
        ).body as FeatureFlagView[]
      ).find((f) => f.key === "ELIGIBILITY_PRECHECK")?.pendingChange?.id as string;
    const rejected = await audits("FEATURE_FLAG_CHANGE_REJECTED");
    const withdrawn = await audits("FEATURE_FLAG_CHANGE_WITHDRAWN");
    const a = await draft();
    await h
      .as("celia")
      .post(`/features/flags/ELIGIBILITY_PRECHECK/changes/${a}/reject`, { note: "Not now" })
      .expect(200);
    const b = await draft();
    await h
      .as("leo")
      .post(`/features/flags/ELIGIBILITY_PRECHECK/changes/${b}/reject`, {})
      .expect(200);
    expect((await flag("ELIGIBILITY_PRECHECK")).enabled).toBe(true);
    expect(await audits("FEATURE_FLAG_CHANGE_REJECTED")).toBe(rejected + 1);
    expect(await audits("FEATURE_FLAG_CHANGE_WITHDRAWN")).toBe(withdrawn + 1);
    // A decided change cannot be decided again.
    const again = await h
      .as("celia")
      .post(`/features/flags/ELIGIBILITY_PRECHECK/changes/${a}/approve`, {})
      .expect(409);
    expect(again.body.code).toBe("INVALID_STATE_TRANSITION");
  });
});

describe("FF-2 an approval and a rejection at once", () => {
  it("exactly one decides the change: one 200, one 409, one decision audited, the flag as the winner left it", async () => {
    const decisions = async () =>
      (await audits("FEATURE_FLAG_CHANGED")) + (await audits("FEATURE_FLAG_CHANGE_WITHDRAWN"));
    const before = await decisions();
    const drafted = (
      await h
        .as("leo")
        .post("/features/flags/EMAIL_INTAKE/changes", { enabled: false, reason: "Race" })
        .expect(201)
    ).body as FeatureFlagView[];
    const id = drafted.find((f) => f.key === "EMAIL_INTAKE")?.pendingChange?.id as string;
    const [approve, withdraw] = await Promise.all([
      h.as("celia").post(`/features/flags/EMAIL_INTAKE/changes/${id}/approve`, {}),
      h.as("leo").post(`/features/flags/EMAIL_INTAKE/changes/${id}/reject`, {}),
    ]);
    expect([approve.status, withdraw.status].sort()).toEqual([200, 409]);
    const loser = approve.status === 409 ? approve : withdraw;
    expect(loser.body.code).toBe("INVALID_STATE_TRANSITION");

    const [change] = (await h.ds.query("SELECT status FROM feature_flag_change WHERE id = $1", [
      id,
    ])) as { status: string }[];
    const approved = approve.status === 200;
    expect(change?.status).toBe(approved ? "APPROVED" : "REJECTED");
    expect((await flag("EMAIL_INTAKE")).enabled).toBe(!approved);
    expect(await decisions()).toBe(before + 1);
  });
});

describe("FF-3 a switched-off module refuses every request, whatever the screen shows", () => {
  it("eligibility pre-check off: 404 FEATURE_DISABLED; on again: answered", async () => {
    await switchFlag("ELIGIBILITY_PRECHECK", false);
    const state = (await h.as("paolo").get("/features").expect(200)).body as FeatureStateView;
    expect(state.ELIGIBILITY_PRECHECK).toBe(false);
    const off = await h.as("paolo").post("/eligibility/pre-check", PRE_CHECK).expect(404);
    expect(off.body.code).toBe("FEATURE_DISABLED");
    await switchFlag("ELIGIBILITY_PRECHECK", true);
    const on = await h.as("paolo").post("/eligibility/pre-check", PRE_CHECK).expect(200);
    expect(on.body.productCode).toBe("PL");
  });

  it("email intake off: listing and uploading are refused and nothing is written", async () => {
    await switchFlag("EMAIL_INTAKE", false);
    const batches = await count(h.ds, "SELECT count(*) AS n FROM intake_batch");
    const list = await h.as("paolo").get("/intake/drafts").expect(404);
    expect(list.body.code).toBe("FEATURE_DISABLED");
    const upload = await h
      .as("paolo")
      .post("/intake/uploads", { source: "EMAIL_BUNDLE" })
      .expect(404);
    expect(upload.body.code).toBe("FEATURE_DISABLED");
    expect(await count(h.ds, "SELECT count(*) AS n FROM intake_batch")).toBe(batches);
    // Compliance's read is refused too: the module is off for everyone.
    await h.as("diane").get("/intake/drafts").expect(404);
  });

  it("role checks still come first: a role the module never allowed still gets 403 while it is off", async () => {
    await switchFlag("EMAIL_INTAKE", false);
    const res = await h.as("rina").post("/intake/uploads", { source: "EMAIL_BUNDLE" }).expect(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("FF-4 a flag with no row is off (fail safe)", () => {
  it("a module whose flag is missing refuses requests", async () => {
    await h.ds.query("DELETE FROM feature_flag WHERE key = 'ELIGIBILITY_PRECHECK'");
    try {
      const res = await h.as("paolo").post("/eligibility/pre-check", PRE_CHECK).expect(404);
      expect(res.body.code).toBe("FEATURE_DISABLED");
      const state = (await h.as("paolo").get("/features").expect(200)).body as FeatureStateView;
      expect(state.ELIGIBILITY_PRECHECK).toBe(false);
    } finally {
      await h.ds.query(
        "INSERT INTO feature_flag (key, enabled) VALUES ('ELIGIBILITY_PRECHECK', true) ON CONFLICT DO NOTHING",
      );
    }
  });
});
