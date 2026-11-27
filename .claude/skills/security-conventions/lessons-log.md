# security lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## security-20261127-gitleaks-allowlist-literal-must-be-anchored

When `.gitleaks.toml` allowlists one published, non-secret value, write the regex anchored
(`'''^Password123!$'''`), not as a bare literal. Why: M9c published one shared test password
and allowlisted it as `'''Password123!'''`. Gitleaks' allowlist `regexes` match against the
extracted secret by default and are unanchored, so the entry also waives any real secret that
merely contains the string (`Password123!prod`, `xPassword123!y`), which is wider than "exactly
that value". The pre-existing `(your-secret-here|changeme|example|placeholder|dummy)` entry has
the same hole at a larger scale. Not made a house check yet: whether the anchored form still
matches depends on what each default detector captures as the secret (quotes, backticks),
which only a gitleaks run can confirm, and review tooling cannot run gitleaks. Nearest gate: a
`check:gitleaks-allowlist-anchored` once the security stage has confirmed the anchored forms
pass.

## security-20261127-throttle-key-needs-a-per-source-cap

When a throttler tracker folds a client-chosen value (username, email, case id) into the key,
keep a second limit keyed on the source address alone for the same route. Why: M9b keyed
`POST /auth/sign-in` on `address|username` so one account's typos would not lock out the
office behind the shared backoffice proxy address. With `@Throttle({ default: … })` overriding
the only throttler, that left no per-source bound at all: rotating the username gives a fresh
bucket every request, so one caller can drive unlimited password-spraying attempts across the
public persona list and unlimited scrypt computations (16 MiB, libuv threadpool) for unknown
usernames. The fix is a second named throttler (e.g. `signInSource`) keyed on the address with
a generous office-wide cap, alongside the per-username one. The test is a loop of distinct
usernames from one address that must eventually get 429.
