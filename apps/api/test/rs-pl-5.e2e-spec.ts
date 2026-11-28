import type { CaseDetail, DecisionRecordView, ReproduceResult } from "@loan/core";
import { type Harness, resetData, startHarness, submitCase, twin } from "./support/harness";

/**
 * RS-PL-5 through the API (PRD DEC-002 warnings; DEC-006 low model confidence, missing data,
 * policy exception; ACCEPTANCE D-18..D-21): each new rule decided on a real submission, stored
 * on the record, and reproduced. Maria's profile scores 742; the changes below are worked out
 * against SC-PL-2's points in each test.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await resetData(h.ds);
});

const decisionOf = async (c: CaseDetail) =>
  (await h.as("paolo").get(`/cases/${c.id}/decision`).expect(200)).body as DecisionRecordView;
const codes = (d: DecisionRecordView) => d.reasonCodes.map((r) => r.code);
const rule = (d: DecisionRecordView, id: string) => d.ruleResults.find((r) => r.id === id);
const reproduce = async (d: DecisionRecordView) =>
  (await h.as("diane").post(`/decisions/${d.id}/reproduce`).expect(200)).body as ReproduceResult;

/** A twin of Maria with her simulated bureau answer and customer months changed. */
async function maria(
  bureau: Record<string, unknown>,
  relationshipMonths?: number,
): Promise<string> {
  const id = await twin(h, "APL-MARIA");
  await h.ds.query(
    "UPDATE sim.persona_profile SET bureau = bureau || $2::jsonb WHERE applicant_id = $1",
    [id, JSON.stringify(bureau)],
  );
  if (relationshipMonths !== undefined) {
    await h.ds.query("UPDATE applicant SET relationship_months = $2 WHERE id = $1", [
      id,
      relationshipMonths,
    ]);
  }
  return id;
}

const submitFor = (applicantId: string, terms: { amount?: string; tenorMonths?: number } = {}) =>
  submitCase(h, { applicantId, ...terms }, { sameApplicant: true });

describe("RS-PL-5 through the API", () => {
  it("D-18: Carmen's warnings are recorded with the decision; they change nothing", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-CARMEN",
      amount: "60000.00",
      tenorMonths: 12,
    });
    expect(c.status).toBe("DECLINED");
    const d = await decisionOf(c);
    expect(d.ruleSetVersion).toBe("RS-PL-5");
    expect(rule(d, "WN-UTILISATION")).toMatchObject({ kind: "WARNING", result: "FAIL" });
    expect(rule(d, "WN-EMPLOYMENT")).toMatchObject({ kind: "WARNING", result: "FAIL" });
    expect(codes(d)).toEqual(["R07", "R04"]);
    expect(await reproduce(d)).toMatchObject({ match: true });
  });

  it("D-19: an approve-band score within 10 points of 700 refers (R27); clear of it, approves", async () => {
    // Utilisation 80% (−25) and new to bank (−15): 702.
    const near = await decisionOf(await submitFor(await maria({ utilisationPct: 80 }, 0)));
    expect([near.score, near.outcome, codes(near)]).toEqual([702, "REFER", ["R27"]]);
    expect(rule(near, "RF-CONFIDENCE")?.result).toBe("FAIL");
    expect(await reproduce(near)).toMatchObject({ match: true });
    // Utilisation 80% only: 717, approved.
    const clear = await submitFor(await maria({ utilisationPct: 80 }));
    expect(clear.status).toBe("OFFER");
    expect((await decisionOf(clear)).score).toBe(717);
  });

  it("D-19: a decline-band score within 10 points of 600 refers instead of declining", async () => {
    // Bureau 560 (−110), utilisation 80% (−25), new to bank (−15): 592.
    const c = await submitFor(await maria({ bureauScore: 560, utilisationPct: 80 }, 0));
    expect(c.status).toBe("REVIEW");
    const d = await decisionOf(c);
    expect([d.score, codes(d)]).toEqual([592, ["R27", "R07"]]);
  });

  it("D-20: a full bureau file without a score refers with R28", async () => {
    const c = await submitFor(await maria({ bureauScore: null }));
    expect(c.status).toBe("REVIEW");
    const d = await decisionOf(c);
    expect(codes(d)).toContain("R28");
    expect(rule(d, "RF-DATA")).toMatchObject({ result: "FAIL", value: "no bureau score" });
    expect(await reproduce(d)).toMatchObject({ match: true });
  });

  it("D-21: a tenor outside 6-month steps refers with R29; a standard one is approved", async () => {
    const odd = await submitCase(h, { applicantId: "APL-MARIA", tenorMonths: 20 });
    expect(odd.status).toBe("REVIEW");
    const d = await decisionOf(odd);
    expect(codes(d)).toEqual(["R29"]);
    expect(rule(d, "RF-POLICY")).toMatchObject({ result: "FAIL", value: "20 months" });
    const standard = await submitCase(h, { applicantId: "APL-MARIA", tenorMonths: 18 });
    expect(standard.status).toBe("OFFER");
  });
});
