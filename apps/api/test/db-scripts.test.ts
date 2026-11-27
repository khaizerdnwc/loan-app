import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * H-6: scripts/db/restore.sh refuses before restoring anything. Fake `psql` and `pg_restore`
 * on PATH record every call (no database is contacted), so each refusal can also prove that
 * nothing was restored — and the confirmation checks that no database was contacted at all.
 */
const RESTORE = resolve(__dirname, "../../../scripts/db/restore.sh");
const URL = "postgres://loan:secret@db.internal:5432/loan";
const LABEL = "db.internal:5432/loan";

let dir: string;
let log: string;
let dump: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "restore-test-"));
  log = join(dir, "calls.log");
  dump = join(dir, "backup.dump");
  writeFileSync(dump, "not a real dump; the fake pg_restore reads it");
  writeFileSync(log, "");
  // pg_restore: the --data-only listing prints the backup's migrations table; otherwise it is
  // the restore itself. psql: answers the migrations-table and head queries.
  fake(
    "pg_restore",
    `echo "pg_restore $*" >>"$FAKE_LOG"; cat >/dev/null
if [[ "$*" == *--data-only* ]]; then
  echo 'COPY public.migrations (id, "timestamp", name) FROM stdin;'
  printf '1\\t1764300000000\\tLendingSchema1764300000000\\n'
  printf '2\\t1764300000006\\tWithdrawAndExpiry1764300000006\\n'
  echo '\\.'
fi`,
  );
  fake(
    "psql",
    `echo "psql $*" >>"$FAKE_LOG"
if [[ "$*" == *to_regclass* ]]; then echo "$FAKE_HAS_TABLE"; else echo "$FAKE_TARGET_HEAD"; fi`,
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fake(name: string, body: string) {
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

function restore(env: Record<string, string>) {
  const res = spawnSync("bash", [RESTORE, dump], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      FAKE_LOG: log,
      FAKE_HAS_TABLE: "f",
      FAKE_TARGET_HEAD: "",
      ...env,
    },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { status: res.status, stderr: res.stderr, stdout: res.stdout, calls };
}

const restored = (calls: string[]) => calls.some((c) => c.includes("--clean"));

describe("restore.sh refusals (H-6)", () => {
  it("refuses without RESTORE_CONFIRM, contacting no database, and never prints the password", () => {
    const r = restore({ DATABASE_URL: URL });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`RESTORE_CONFIRM=${LABEL}`);
    expect(r.stderr + r.stdout).not.toContain("secret");
    expect(r.calls).toEqual([]);
  });

  it("refuses a confirmation naming only the database (a same-named database elsewhere)", () => {
    const r = restore({ DATABASE_URL: URL, RESTORE_CONFIRM: "loan" });
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it("refuses a confirmation for another host", () => {
    const r = restore({ DATABASE_URL: URL, RESTORE_CONFIRM: "db.other:5432/loan" });
    expect(r.status).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it.each(["postgres://loan:secret@db.internal:5432", "postgres://loan:secret@db.internal:5432/"])(
    "refuses a URL that names no database (%s)",
    (url) => {
      const r = restore({ DATABASE_URL: url, RESTORE_CONFIRM: "db.internal:5432/" });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("names no database");
      expect(r.calls).toEqual([]);
    },
  );

  it("refuses a target at a different migration head, without restoring", () => {
    const r = restore({
      DATABASE_URL: URL,
      RESTORE_CONFIRM: LABEL,
      FAKE_HAS_TABLE: "t",
      FAKE_TARGET_HEAD: "NewerThing1764300009999",
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("NewerThing1764300009999");
    expect(r.stderr).toContain("WithdrawAndExpiry1764300000006");
    expect(restored(r.calls)).toBe(false);
  });

  it("restores into an empty target (no migrations table)", () => {
    const r = restore({ DATABASE_URL: URL, RESTORE_CONFIRM: LABEL });
    expect(r.status).toBe(0);
    expect(restored(r.calls)).toBe(true);
    expect(r.stdout).toContain("WithdrawAndExpiry1764300000006");
  });

  it("restores into a target at the same migration head", () => {
    const r = restore({
      DATABASE_URL: URL,
      RESTORE_CONFIRM: LABEL,
      FAKE_HAS_TABLE: "t",
      FAKE_TARGET_HEAD: "WithdrawAndExpiry1764300000006",
    });
    expect(r.status).toBe(0);
    expect(restored(r.calls)).toBe(true);
  });
});
