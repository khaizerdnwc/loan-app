# WhiteBank Lending MVP

A staff-facing web MVP that takes a personal loan from application through automated credit
decision, referral review, approval within authority, and booking with disbursement into a
simulated core banking system. All data is synthetic, and every external service (credit
bureau, KYC/AML, core banking, disbursement, e-signature) is simulated behind an interface.

## Run it

```bash
pnpm install && pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev
# backoffice http://localhost:3100 · API http://localhost:3101 (Swagger at /docs when SWAGGER_ENABLED=true, as in apps/api/.env.example)
```

Or the whole stack from the production images:
`JWT_SECRET=$(openssl rand -hex 32) docker compose up --build`
(backoffice http://localhost:8100).

**Sign in:** see [docs/TEST-ACCOUNTS.md](docs/TEST-ACCOUNTS.md). It lists eight seeded staff
accounts, one per role, all with the test password `Password123!`. These are published test
credentials for synthetic data.

## Read next

| | |
|---|---|
| What was built and why | [docs/design-notes.md](docs/design-notes.md) |
| Acceptance criteria and the test that proves each | [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) |
| Assumptions where the materials were silent | [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) |
| Architecture and security boundaries | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS/](docs/DECISIONS/) |
| API | [docs/API.md](docs/API.md) |
| Deploying | [docs/DEPLOY.md](docs/DEPLOY.md) |
| How AI was used, and how it was checked | [docs/ai-evidence/README.md](docs/ai-evidence/README.md), [docs/AGENT-WORKFLOW.md](docs/AGENT-WORKFLOW.md) |
| Agent guide | [AGENTS.md](AGENTS.md) |

## Checks

`pnpm verify` runs the full gate locally: security, static, unit, database with integration,
and build with Playwright. Pull requests run the same stages in GitHub Actions, and `main`
requires all of them to pass.
