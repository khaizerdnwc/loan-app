# security lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

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
