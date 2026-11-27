#!/usr/bin/env tsx
/**
 * pnpm review:roles [--cached | <base-ref>] — which role reviewers a diff needs, the files
 * each one owns, and the lessons each must answer (ADR 0017).
 *
 * /review reads this instead of mapping paths to roles by hand, and pastes each role's
 * block into that reviewer's prompt. `pnpm review:ack` later recomputes the same thing to
 * check every listed lesson was answered.
 */
import { findRepoRoot, lessonsFor } from "./_lessons";
import { changedFiles, newFeatureDirs, resolveDiff, reviewRoles } from "./_review";

const root = findRepoRoot();
const spec = resolveDiff(root, process.argv[2]);
const files = changedFiles(root, spec);

if (files.length === 0) {
  console.info(`review:roles: nothing changed (${spec.label})`);
  process.exit(0);
}

const roles = reviewRoles(files, newFeatureDirs(root, spec, files));
console.info(
  `review:roles (${spec.label}, ${files.length} files) → ${[...roles.keys()].join(", ") || "none"}`,
);
for (const [role, mine] of roles) {
  const lessons = lessonsFor(root, mine, role);
  console.info(`\n## ${role}`);
  console.info("Files:");
  for (const f of mine) console.info(`  ${f}`);
  console.info(lessons.length ? "Lessons to answer:" : "Lessons to answer: (none)");
  for (const l of lessons) console.info(`  ${l.raw}`);
}
