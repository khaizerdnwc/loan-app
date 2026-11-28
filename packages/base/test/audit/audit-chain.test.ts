import {
  type ChainedFields,
  chainHash,
  checkLinks,
  GENESIS_HASH,
  plainDetails,
  type StoredLink,
} from "../../src/audit/audit-chain";

function chain(n: number): StoredLink[] {
  const out: StoredLink[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq += 1) {
    const fields: ChainedFields = {
      seq,
      occurredAt: new Date(Date.UTC(2026, 10, 28, 1, 0, seq)).toISOString(),
      actorId: "STF-DIANE",
      actorName: "Diane Yu",
      actorRole: "COMPLIANCE",
      action: "SIGN_IN_SUCCEEDED",
      caseId: null,
      caseReference: null,
      summary: `Entry ${seq}.`,
      details: { b: 2, a: { y: [1, 2], x: "₱1,000.00" } },
    };
    const hash = chainHash(prev, fields);
    out.push({ ...fields, prevHash: prev, hash });
    prev = hash;
  }
  return out;
}

describe("audit hash chain (PRD CMP-010)", () => {
  it("each hash is sha256 of the previous hash and the canonical entry", () => {
    const [first] = chain(1);
    expect(first?.prevHash).toBe(GENESIS_HASH);
    expect(first?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("key order in details does not change the hash (jsonb reorders keys)", () => {
    const [e] = chain(1);
    if (!e) throw new Error("no entry");
    const { prevHash, hash, ...fields } = e;
    const reordered = { ...fields, details: { a: { x: "₱1,000.00", y: [1, 2] }, b: 2 } };
    expect(chainHash(prevHash, reordered)).toBe(hash);
  });

  it("an intact chain checks out, also across batches", () => {
    const all = chain(5);
    expect(checkLinks(all, null)).toMatchObject({ checked: 5, firstBrokenSeq: null });
    const first = checkLinks(all.slice(0, 2), null);
    expect(checkLinks(all.slice(2), first.last, first.checked)).toMatchObject({
      checked: 5,
      problem: null,
      last: { seq: 5, hash: all[4]?.hash },
    });
  });

  it("a changed field breaks the entry it is in", () => {
    const all = chain(4);
    const tampered = all.map((e) => (e.seq === 3 ? { ...e, summary: "Something else." } : e));
    expect(checkLinks(tampered, null)).toMatchObject({
      checked: 2,
      firstBrokenSeq: 3,
      problem: expect.stringMatching(/changed/),
    });
  });

  it("a re-hashed entry breaks the link to the next one", () => {
    const all = chain(4);
    const target = all[1];
    if (!target) throw new Error("no entry");
    const { prevHash, hash: _old, ...fields } = target;
    const forged = { ...fields, summary: "Forged." };
    const rehashed = { ...forged, prevHash, hash: chainHash(prevHash, forged) };
    const tampered = all.map((e) => (e.seq === 2 ? rehashed : e));
    expect(checkLinks(tampered, null)).toMatchObject({
      firstBrokenSeq: 3,
      problem: expect.stringMatching(/does not link/),
    });
  });

  it("a removed entry is reported as missing", () => {
    const all = chain(4).filter((e) => e.seq !== 2);
    expect(checkLinks(all, null)).toMatchObject({
      firstBrokenSeq: 2,
      problem: expect.stringMatching(/missing/),
    });
  });

  it("details are hashed as they read back from jsonb (a Date becomes text)", () => {
    const when = new Date("2026-11-28T01:02:03.004Z");
    expect(plainDetails({ when, gone: undefined })).toEqual({ when: when.toISOString() });
    expect(plainDetails(undefined)).toEqual({});
  });
});
