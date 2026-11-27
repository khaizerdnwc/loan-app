#!/usr/bin/env tsx
/**
 * License allowlist gate — `pnpm exec tsx scripts/check-licenses.ts`.
 *
 * Replaces the unmaintained `license-checker` (whose glob@7/minimatch@3 chain
 * carried an unpatchable brace-expansion advisory, and which — under pnpm's
 * symlinked layout — silently scanned only DIRECT dependencies). This uses
 * pnpm's own `pnpm licenses list -r`, which covers the ENTIRE workspace —
 * every importer, not just the root package (which has almost no deps now).
 *
 * Policy: copyleft licenses that could encumber the shipped product (GPL,
 * AGPL) are rejected. Weak/file-level copyleft that does not affect an
 * unmodified SaaS deployment (MPL-2.0) is allowed. Anything else fails the
 * build unless listed in PACKAGE_EXCEPTIONS with a documented reason.
 */

import { execFileSync } from "node:child_process";

/** SPDX expressions accepted outright. Dual (OR) licenses where one side is
 *  allowed, and combinations (AND) of allowed licenses, are also accepted —
 *  see `expressionAllowed`. */
const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "0BSD",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  // The same permissive Python Software Foundation license under its newer
  // SPDX id; argparse 3 (via js-yaml 5) relabelled itself from Python-2.0.
  "PSF-2.0",
  // File-level copyleft: using an unmodified library in a SaaS app imposes
  // no obligations on our code (lightningcss — Tailwind's CSS engine).
  "MPL-2.0",
]);

/** Per-package exceptions with the reason they're safe. Keep this SHORT. */
const PACKAGE_EXCEPTIONS: Record<string, string> = {
  // libvips binaries (via next→sharp): LGPL, DYNAMICALLY linked, unmodified.
  // We don't distribute the app, so LGPL's copyleft never attaches.
  "@img/sharp-libvips-darwin-arm64": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-darwin-x64": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-linux-arm": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-linux-arm64": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-linux-ppc64": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-linux-s390x": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-linux-x64": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-linuxmusl-arm64": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-linuxmusl-x64": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-win32-arm64": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-win32-ia32": "LGPL-3.0-or-later — dynamically linked image lib",
  "@img/sharp-libvips-win32-x64": "LGPL-3.0-or-later — dynamically linked image lib",
  // Sentry's CLI (via @sentry/nextjs): FSL-1.1-MIT — build-time tool for
  // sourcemap upload, never shipped; FSL converts to MIT after two years.
  "@sentry/cli": "FSL-1.1-MIT — build-time tool, not distributed",
  "@sentry/cli-darwin": "FSL-1.1-MIT — build-time tool, not distributed",
  "@sentry/cli-linux-arm": "FSL-1.1-MIT — build-time tool, not distributed",
  "@sentry/cli-linux-arm64": "FSL-1.1-MIT — build-time tool, not distributed",
  "@sentry/cli-linux-i686": "FSL-1.1-MIT — build-time tool, not distributed",
  "@sentry/cli-linux-x64": "FSL-1.1-MIT — build-time tool, not distributed",
  "@sentry/cli-win32-i686": "FSL-1.1-MIT — build-time tool, not distributed",
  "@sentry/cli-win32-x64": "FSL-1.1-MIT — build-time tool, not distributed",
  "@sentry/cli-win32-arm64": "FSL-1.1-MIT — build-time tool, not distributed",
};

/** Whole-scope exceptions, for vendors that ship one licence across many
 *  packages (including per-platform binaries that only install on some OSes,
 *  so naming them one by one passes locally and fails in CI). */
const SCOPE_EXCEPTIONS: Record<string, string> = {
  // Remotion (video-production/remotion only — renders promo videos, never part of the
  // shipped app). Remotion License: free for individuals and for-profit orgs of
  // up to 3 people; NXLVL qualifies (decided 2026-10-09). Re-check if that
  // changes — beyond it a paid Company License is required.
  "@remotion/": "Remotion License — promo video tooling, free tier",
  remotion: "Remotion License — promo video tooling, free tier",
};

function isExcepted(name: string): boolean {
  if (PACKAGE_EXCEPTIONS[name]) return true;
  return Object.keys(SCOPE_EXCEPTIONS).some((scope) =>
    scope.endsWith("/") ? name.startsWith(scope) : name === scope,
  );
}

/** An SPDX expression passes if it's allowed outright, if it's an OR where
 *  any alternative is allowed, or an AND where every part is allowed. */
function expressionAllowed(expression: string): boolean {
  const spdx = expression.replace(/^\(|\)$/g, "").trim();
  if (ALLOWED.has(spdx)) return true;
  if (spdx.includes(" OR ")) return spdx.split(" OR ").some((part) => expressionAllowed(part));
  if (spdx.includes(" AND ")) return spdx.split(" AND ").every((part) => expressionAllowed(part));
  return false;
}

interface LicensePackage {
  name: string;
  versions: string[];
}

const raw = execFileSync("pnpm", ["-r", "licenses", "list", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(raw) as Record<string, LicensePackage[]>;

const violations: { name: string; license: string }[] = [];
let scanned = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  const ok = expressionAllowed(license);
  for (const pkg of packages) {
    scanned++;
    if (ok) continue;
    if (isExcepted(pkg.name)) continue;
    violations.push({ name: pkg.name, license });
  }
}

if (violations.length > 0) {
  console.error(`✖ ${violations.length} package(s) with disallowed licenses:`);
  for (const v of violations) console.error(`   ${v.name} — ${v.license}`);
  console.error(
    "\nAllow the license in scripts/check-licenses.ts (with reasoning) or replace the dependency.",
  );
  process.exit(1);
}

console.info(`✔ license check passed (${scanned} packages, full dependency tree)`);
