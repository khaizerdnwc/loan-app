import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkLedgers,
  globToRegExp,
  LESSONS_BUDGET_BYTES,
  lessonsFor,
  parseLessons,
  parseLog,
  splitTopLevel,
} from "../src/_lessons";

const line = (id: string, paths: string, shape = "judgment", text = "Do the thing. Check: it.") =>
  `- [${id}] paths: ${paths} · shape: ${shape} · ${text}`;

describe("globToRegExp", () => {
  it.each([
    ["apps/web/src/features/*/db/**", "apps/web/src/features/teams/db/schema.ts", true],
    ["apps/web/src/features/*/db/**", "apps/web/src/features/teams/db/sub/x.ts", true],
    ["apps/web/src/features/*/db/**", "apps/web/src/features/teams/server/x.ts", false],
    ["apps/web/src/**/*.tsx", "apps/web/src/features/teams/pages/index.page.tsx", true],
    ["apps/web/src/**/*.tsx", "apps/web/src/x.tsx", true],
    ["apps/web/src/**/*.tsx", "apps/web/src/x.ts", false],
    ["**", "anything/at/all.md", true],
    ["apps/web/src/lib/{auth,authz}/**", "apps/web/src/lib/authz/index.ts", true],
    ["apps/web/src/lib/{auth,authz}/**", "apps/web/src/lib/authx/index.ts", false],
    [
      "apps/web/src/features/*/server/actions.ts",
      "apps/web/src/features/a/server/actions.ts",
      true,
    ],
    // `*` never crosses a directory.
    ["apps/web/src/*.ts", "apps/web/src/lib/env.ts", false],
    // Braces can hold wildcards, and nest.
    ["apps/web/src/**/*.{ts,tsx}", "apps/web/src/features/a/b.tsx", true],
    ["apps/web/src/{*.ts,lib/**}", "apps/web/src/lib/env/x.ts", true],
    ["apps/web/src/{*.ts,lib/**}", "apps/web/src/features/x.ts", false],
    ["apps/web/{src/{a,b},e2e}/**", "apps/web/src/b/x.ts", true],
    // `?` is one character; `**/` may match zero directories; an unmatched `{` is literal.
    ["apps/web/src/?.ts", "apps/web/src/a.ts", true],
    ["apps/web/src/?.ts", "apps/web/src/ab.ts", false],
    ["apps/web/**/env.ts", "apps/web/env.ts", true],
    ["apps/web/{oops", "apps/web/{oops", true],
    // Dots are literal.
    ["apps/web/.env.example", "apps/web/xenvxexample", false],
  ])("%s ~ %s → %s", (glob, file, expected) => {
    expect(globToRegExp(glob).test(file)).toBe(expected);
  });
});

describe("splitTopLevel", () => {
  it("does not split inside braces", () => {
    expect(splitTopLevel("apps/web/src/**/*.{ts,tsx}, apps/web/drizzle/**")).toEqual([
      "apps/web/src/**/*.{ts,tsx}",
      "apps/web/drizzle/**",
    ]);
  });
});

describe("parseLessons", () => {
  it("parses a valid entry and ignores headings and prose", () => {
    const src = [
      "# Security lessons",
      "",
      "Intro text is free.",
      line("security-20260928-policy-pin", "apps/web/src/features/*/db/**, apps/web/drizzle/**"),
    ].join("\n");
    const { lessons, errors } = parseLessons("security", src);
    expect(errors).toEqual([]);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.paths).toEqual(["apps/web/src/features/*/db/**", "apps/web/drizzle/**"]);
    expect(lessons[0]?.line).toBe(4);
  });

  it("rejects a bullet that is not a lesson line", () => {
    const { errors } = parseLessons("security", "- 2026-09-28 — an old-style narrative entry");
    expect(errors[0]).toMatch(/^1: not a lesson line/);
  });

  it("rejects an id for another role, a bad shape, and an overlong line", () => {
    const long = line("security-20260928-x", "**", "judgment", "x".repeat(400));
    const { errors } = parseLessons(
      "security",
      [line("data-20260928-x", "**"), line("security-20260928-y", "**", "vibes"), long].join("\n"),
    );
    expect(errors.join("\n")).toMatch(/must start with "security-"/);
    expect(errors.join("\n")).toMatch(/shape "vibes"/);
    expect(errors.join("\n")).toMatch(/over 320/);
  });
});

describe("parseLog", () => {
  it("splits sections and reads the Gate line", () => {
    const log = parseLog(
      "data",
      [
        "# Data lessons — log",
        "",
        "## data-20260928-a",
        "Gate: house/require-timestamptz",
        "Long story.",
        "",
        "## data-20260927-b",
        "Another.",
      ].join("\n"),
    );
    expect(log.map((e) => [e.id, e.gate])).toEqual([
      ["data-20260928-a", "house/require-timestamptz"],
      ["data-20260927-b", null],
    ]);
  });
});

describe("checkLedgers and lessonsFor", () => {
  let root: string;

  const write = (rel: string, content: string) => {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lessons-"));
    write("pnpm-workspace.yaml", "packages: []\n");
    write("packages/eslint-house/src/rules/require-timestamptz.js", "export default {};\n");
    write(
      ".claude/skills/data-conventions/lessons.md",
      [
        "# Data lessons",
        line("data-20260928-a", "apps/web/src/features/*/db/**"),
        line("data-20260927-b", "apps/web/src/**/*.tsx"),
      ].join("\n"),
    );
    write(
      ".claude/skills/data-conventions/lessons-log.md",
      [
        "## data-20260928-a",
        "a",
        "## data-20260927-b",
        "b",
        "## data-20260901-c",
        "Gate: house/require-timestamptz",
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("passes a well-formed ledger", () => {
    expect(checkLedgers(root)).toEqual([]);
  });

  it("selects only lessons whose paths match", () => {
    const hits = lessonsFor(root, ["apps/web/src/features/teams/db/schema.ts"]);
    expect(hits.map((l) => l.id)).toEqual(["data-20260928-a"]);
    expect(lessonsFor(root, ["README.md"])).toEqual([]);
  });

  it("fails a lesson with no log section", () => {
    write(
      ".claude/skills/data-conventions/lessons.md",
      line("data-20260930-orphan", "apps/web/src/db/**"),
    );
    expect(checkLedgers(root).join("\n")).toMatch(/has no "## data-20260930-orphan" section/);
  });

  it("fails a gated lesson that is still loaded", () => {
    write(
      ".claude/skills/data-conventions/lessons.md",
      line("data-20260901-c", "apps/web/src/db/**"),
    );
    expect(checkLedgers(root).join("\n")).toMatch(/gated by house\/require-timestamptz/);
  });

  it("fails a Gate that names a rule that does not exist", () => {
    write(
      ".claude/skills/data-conventions/lessons-log.md",
      "## data-20260901-c\nGate: house/nope\n",
    );
    write(".claude/skills/data-conventions/lessons.md", "# Data lessons\n");
    expect(checkLedgers(root).join("\n")).toMatch(
      /Gate "house\/nope" names a rule that does not exist/,
    );
  });

  it("enforces the budget, charging `**` lessons triple", () => {
    const entries: string[] = [];
    const log: string[] = [];
    // ~200-byte lines on `**`: 14 of them is ~2.8 kB raw but ~8.4 kB weighted.
    for (let i = 0; i < 14; i++) {
      const id = `data-20260928-w${i}`;
      entries.push(line(id, "**", "judgment", `${"y".repeat(150)}. Check: z.`));
      log.push(`## ${id}`, "n");
    }
    write(".claude/skills/data-conventions/lessons.md", entries.join("\n"));
    write(".claude/skills/data-conventions/lessons-log.md", log.join("\n"));
    const problems = checkLedgers(root).join("\n");
    expect(problems).toMatch(new RegExp(`over the ${LESSONS_BUDGET_BYTES}-byte budget`));
  });

  it("reports a parse error with its file and line", () => {
    write(
      ".claude/skills/data-conventions/lessons.md",
      "# Data lessons\n\n- an old narrative bullet",
    );
    expect(checkLedgers(root).join("\n")).toMatch(
      /\.claude\/skills\/data-conventions\/lessons\.md:3: not a lesson line/,
    );
  });

  it("fails an id used by two roles", () => {
    write(".claude/skills/qa-conventions/lessons.md", line("data-20260928-a", "apps/web/e2e/**"));
    write(".claude/skills/qa-conventions/lessons-log.md", "## data-20260928-a\nx\n");
    const problems = checkLedgers(root).join("\n");
    expect(problems).toMatch(/must start with "qa-"/);
    expect(problems).toMatch(/duplicate id "data-20260928-a"/);
  });

  it("fails a duplicate or misnamed log section", () => {
    write(
      ".claude/skills/data-conventions/lessons-log.md",
      [
        "## data-20260928-a",
        "a",
        "## data-20260927-b",
        "b",
        "## data-20260927-b",
        "again",
        "## security-20260901-x",
        "wrong role",
      ].join("\n"),
    );
    const problems = checkLedgers(root).join("\n");
    expect(problems).toMatch(/duplicate log section "data-20260927-b"/);
    expect(problems).toMatch(/id "security-20260901-x" must start with "data-"/);
  });

  it("accepts a Gate list and non-lint gates, and checks only house/ names", () => {
    write(
      ".claude/skills/data-conventions/lessons-log.md",
      [
        "## data-20260928-a",
        "a",
        "## data-20260927-b",
        "b",
        "## data-20260901-c",
        "Gate: house/require-timestamptz, test: apps/web/src/x.test.ts, house/missing-rule",
      ].join("\n"),
    );
    const problems = checkLedgers(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Gate "house\/missing-rule"/);
  });

  it("fails a Gate naming a registered check that does not exist", () => {
    write("tools/review/src/checks/real-check.ts", "export default {};\n");
    write(
      ".claude/skills/data-conventions/lessons-log.md",
      "## data-20260928-a\na\n## data-20260927-b\nb\n## data-20260901-c\nGate: check:real-check, check:no-such-check\n",
    );
    const problems = checkLedgers(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Gate "check:no-such-check" names a check that does not exist/);
  });

  it("filters by role, dedupes, and accepts app-relative paths", () => {
    write(
      ".claude/skills/qa-conventions/lessons.md",
      line("qa-20260928-z", "apps/web/src/features/*/db/**"),
    );
    write(".claude/skills/qa-conventions/lessons-log.md", "## qa-20260928-z\nz\n");
    const both = lessonsFor(root, [
      "apps/web/src/features/teams/db/schema.ts",
      "apps/web/src/features/lfg/db/schema.ts",
    ]);
    expect(both.map((l) => l.id)).toEqual(["data-20260928-a", "qa-20260928-z"]);
    expect(
      lessonsFor(root, ["apps/web/src/features/teams/db/schema.ts"], "qa").map((l) => l.id),
    ).toEqual(["qa-20260928-z"]);
    // Absolute paths are normalised to repo-relative.
    expect(
      lessonsFor(root, [join(root, "apps/web/src/features/teams/db/schema.ts")], "data").map(
        (l) => l.id,
      ),
    ).toEqual(["data-20260928-a"]);
  });

  it("caps the auto-loaded agent memory index", () => {
    write(".claude/agent-memory/data/MEMORY.md", "x".repeat(5_000));
    expect(checkLedgers(root).join("\n")).toMatch(/MEMORY\.md: 5000 bytes over/);
  });
});
