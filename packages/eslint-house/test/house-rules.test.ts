import { join } from "node:path";
import { type Rule, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import { REPO_ROOT } from "../src/_app-path.js";
import moneyColumnNumeric from "../src/rules/money-column-numeric.js";
import moneyThroughFormatter from "../src/rules/money-through-formatter.js";
import noArbitraryTextSize from "../src/rules/no-arbitrary-text-size.js";
import noCaseStatusAssignmentOutsideLifecycle from "../src/rules/no-case-status-assignment-outside-lifecycle.js";
import noCommentedOutCode from "../src/rules/no-commented-out-code.js";
import noConsoleInServer from "../src/rules/no-console-in-server.js";
import noDatasourceOutsideRepository from "../src/rules/no-datasource-outside-repository.js";
import noEngineVersionLiteral from "../src/rules/no-engine-version-literal.js";
import noFloatMoney from "../src/rules/no-float-money.js";
import noMathRandomInServer from "../src/rules/no-math-random-in-server.js";
import noMoneyParseInController from "../src/rules/no-money-parse-in-controller.js";
import noProcessEnvOutsideConfig from "../src/rules/no-process-env-outside-config.js";
import noProviderImportOutsideAdapters from "../src/rules/no-provider-import-outside-adapters.js";
import noRawColour from "../src/rules/no-raw-colour.js";
import noReasonCodeLiteral from "../src/rules/no-reason-code-literal.js";
import noServerEnvInClient from "../src/rules/no-server-env-in-client.js";
import noStatusOnlyAssertion from "../src/rules/no-status-only-assertion.js";
import noTodoComment from "../src/rules/no-todo-comment.js";
import noTypeormSynchronize from "../src/rules/no-typeorm-synchronize.js";
import problemCodeThroughConstant from "../src/rules/problem-code-through-constant.js";
import requireOrderWithTake from "../src/rules/require-order-with-take.js";
import requireRolesOnControllerHandler from "../src/rules/require-roles-on-controller-handler.js";
import requireShapeWithValidateNested from "../src/rules/require-shape-with-validate-nested.js";

/** The rules are plain JS; their inferred literal types are narrower than ESLint's. */
const asRule = (rule: unknown) => rule as Rule.RuleModule;

// The static hooks exist at runtime but not in ESLint's type definitions.
const hooks = RuleTester as unknown as Record<"afterAll" | "describe" | "it" | "itOnly", unknown>;
hooks.afterAll = afterAll;
hooks.describe = describe;
hooks.it = it;
hooks.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** An absolute filename in the repo, so the rules' path gates see real locations. */
const at = (rel: string) => join(REPO_ROOT, rel);

const API = at("apps/api/src/booking/booking.service.ts");
const BASE = at("packages/base/src/booking/booking.service.ts");
const WEB = at("apps/backoffice/src/app/cases/page.tsx");

ruleTester.run("no-commented-out-code", asRule(noCommentedOutCode), {
  valid: [
    {
      filename: BASE,
      code: "// The final instalment absorbs the rounding remainder.\nconst a = 1;",
    },
    { filename: BASE, code: "/** Example:\n * const x = schedule(p);\n */\nconst a = 1;" },
    { filename: BASE, code: "// eslint-disable-next-line no-console\nconst a = 1;" },
    { filename: at("apps/api/test/x.e2e-spec.ts"), code: "// const old = 1;\nconst a = 1;" },
  ],
  invalid: [
    {
      filename: BASE,
      code: "// const old = compute(p);\nconst a = 1;",
      errors: [{ messageId: "commentedCode" }],
    },
    {
      filename: BASE,
      code: "// await repo.save(x);\nconst a = 1;",
      errors: [{ messageId: "commentedCode" }],
    },
    {
      filename: BASE,
      code: "/* if (x) {\n  y();\n} */\nconst a = 1;",
      errors: [{ messageId: "commentedCode" }],
    },
  ],
});

ruleTester.run("no-todo-comment", asRule(noTodoComment), {
  valid: [
    { filename: BASE, code: "// Locks the row so two checkers cannot book twice.\nconst a = 1;" },
    { filename: at("apps/api/test/x.e2e-spec.ts"), code: "// TODO later\nconst a = 1;" },
  ],
  invalid: [
    {
      filename: BASE,
      code: "// TODO: handle timeout\nconst a = 1;",
      errors: [{ messageId: "todo" }],
    },
    {
      filename: WEB,
      code: "/* FIXME wrong total */\nconst a = 1;",
      errors: [{ messageId: "todo" }],
    },
  ],
});

ruleTester.run("no-console-in-server", asRule(noConsoleInServer), {
  valid: [
    { filename: API, code: "this.logger.log('booked');" },
    { filename: WEB, code: "console.error('render failed');" },
  ],
  invalid: [
    { filename: API, code: "console.log(applicant);", errors: [{ messageId: "console" }] },
    { filename: BASE, code: "console.info('x');", errors: [{ messageId: "console" }] },
  ],
});

ruleTester.run("no-math-random-in-server", asRule(noMathRandomInServer), {
  valid: [
    { filename: API, code: "const key = crypto.randomUUID();" },
    { filename: at("packages/base/src/seed/seed.ts"), code: "const n = Math.random();" },
    { filename: WEB, code: "const id = Math.random();" },
  ],
  invalid: [
    {
      filename: API,
      code: "const key = Math.random().toString(36);",
      errors: [{ messageId: "mathRandom" }],
    },
  ],
});

ruleTester.run("no-process-env-outside-config", asRule(noProcessEnvOutsideConfig), {
  valid: [
    { filename: at("apps/api/src/config/env.ts"), code: "const raw = process.env;" },
    { filename: at("apps/backoffice/src/config/env.ts"), code: "const u = process.env.API_URL;" },
    { filename: at("apps/api/test/setup.ts"), code: "const u = process.env.DATABASE_URL;" },
  ],
  invalid: [
    {
      filename: API,
      code: "const s = process.env.JWT_SECRET;",
      errors: [{ messageId: "processEnv" }],
    },
    { filename: WEB, code: "fetch(process.env.API_URL);", errors: [{ messageId: "processEnv" }] },
  ],
});

ruleTester.run("require-roles-on-controller-handler", asRule(requireRolesOnControllerHandler), {
  valid: [
    {
      filename: at("apps/api/src/booking/booking.controller.ts"),
      code: `@Controller("bookings") class C { @Post() @Roles(Role.LoanOperations) submit() {} }`,
    },
    {
      filename: at("apps/api/src/health/health.controller.ts"),
      code: `@Controller("health") class C { @Get() @Public() ok() {} }`,
    },
    {
      filename: at("apps/api/src/queue/queue.controller.ts"),
      code: `@Roles(Role.LoanOfficer) @Controller("queue") class C { @Get() list() {} helper() {} }`,
    },
    { filename: API, code: "class NotAController { @Get() x() {} }" },
  ],
  invalid: [
    {
      filename: at("apps/api/src/approvals/approvals.controller.ts"),
      code: `@Controller("approvals") class C { @Post(":id/approve") approve() {} }`,
      errors: [{ messageId: "missing" }],
    },
  ],
});

ruleTester.run("no-float-money", asRule(noFloatMoney), {
  valid: [
    { filename: BASE, code: "const total = principal.plus(interest);" },
    { filename: BASE, code: "const n = tenorMonths * 2; const i = instalmentCount - 1;" },
    { filename: at("packages/core/src/money/money.ts"), code: "const x = amount * 100;" },
    {
      filename: BASE,
      code: "class E { @Column({ type: 'numeric', precision: 14, scale: 2 }) amount; }",
    },
    { filename: at("packages/base/test/x.test.ts"), code: "const x = amount * 2;" },
  ],
  invalid: [
    {
      filename: BASE,
      code: "const t = principal + interest;",
      errors: [{ messageId: "arithmetic" }],
    },
    {
      filename: BASE,
      code: "const m = loan.amount / tenor;",
      errors: [{ messageId: "arithmetic" }],
    },
    {
      filename: BASE,
      code: "const x = parseFloat(dto.amount);",
      errors: [{ messageId: "conversion" }],
    },
    {
      filename: BASE,
      code: "const x = Number(row.principal);",
      errors: [{ messageId: "conversion" }],
    },
    {
      filename: BASE,
      code: "const s = balance.toFixed(2);",
      errors: [{ messageId: "conversion" }],
    },
    { filename: BASE, code: "const s = +dto.amount;", errors: [{ messageId: "conversion" }] },
    {
      filename: BASE,
      code: "class E { @Column({ type: 'double precision' }) principal; }",
      errors: [{ messageId: "floatColumn" }],
    },
  ],
});

ruleTester.run("no-datasource-outside-repository", asRule(noDatasourceOutsideRepository), {
  valid: [
    {
      filename: at("packages/base/src/booking/booking.repository.ts"),
      code: "class R { constructor(@InjectDataSource() ds) {} }",
    },
    {
      filename: at("packages/base/src/database/transaction-runner.ts"),
      code: "class T { constructor(@InjectDataSource() ds) {} }",
    },
    {
      filename: at("packages/base/src/database/migrations/1-init.ts"),
      code: "q.query('CREATE TABLE x ()');",
    },
    { filename: BASE, code: "const rows = await this.repo.findOpen();" },
  ],
  invalid: [
    {
      filename: BASE,
      code: "class S { constructor(@InjectDataSource() ds) {} }",
      errors: [{ messageId: "inject" }],
    },
    {
      filename: BASE,
      code: "class S { constructor(@InjectEntityManager() em) {} }",
      errors: [{ messageId: "inject" }],
    },
    {
      filename: BASE,
      code: "const r = await ds.query('SELECT 1');",
      errors: [{ messageId: "rawQuery" }],
    },
    {
      filename: API,
      code: "const ds = new DataSource({});",
      errors: [{ messageId: "newDataSource" }],
    },
  ],
});

ruleTester.run("no-typeorm-synchronize", asRule(noTypeormSynchronize), {
  valid: [
    {
      filename: at("packages/base/src/database/data-source.ts"),
      code: "const o = { synchronize: false };",
    },
    { filename: at("apps/api/test/x.e2e-spec.ts"), code: "const o = { synchronize: true };" },
  ],
  invalid: [
    {
      filename: at("packages/base/src/database/data-source.ts"),
      code: "const o = { type: 'postgres', synchronize: true };",
      errors: [{ messageId: "synchronize" }],
    },
  ],
});

ruleTester.run("require-order-with-take", asRule(requireOrderWithTake), {
  valid: [
    { filename: BASE, code: "repo.find({ take: 20, order: { createdAt: 'DESC' } });" },
    {
      filename: BASE,
      code: "repo.createQueryBuilder('a').orderBy('a.createdAt').take(5).getMany();",
    },
    { filename: BASE, code: "repo.find({ where: { id } });" },
  ],
  invalid: [
    {
      filename: BASE,
      code: "repo.find({ where: { s }, take: 20 });",
      errors: [{ messageId: "options" }],
    },
    {
      filename: BASE,
      code: "repo.createQueryBuilder('a').where('x').take(5).getMany();",
      errors: [{ messageId: "chain" }],
    },
  ],
});

ruleTester.run("no-provider-import-outside-adapters", asRule(noProviderImportOutsideAdapters), {
  valid: [
    {
      filename: at("apps/api/src/app.module.ts"),
      code: "import { SimulatedBureau } from './adapters/simulated/bureau';",
    },
    {
      filename: at("apps/api/src/adapters/simulated/core-banking.ts"),
      code: "import { x } from './state';",
    },
    { filename: BASE, code: "import { CREDIT_BUREAU, type CreditBureau } from '@loan/contracts';" },
    {
      filename: at("apps/api/test/booking.e2e-spec.ts"),
      code: "import { SimulatedCoreBanking } from '../src/adapters/simulated/core-banking';",
    },
  ],
  invalid: [
    {
      filename: BASE,
      code: "import { SimulatedBureau } from '../../../apps/api/src/adapters/simulated/bureau';",
      errors: [{ messageId: "adapterImport" }],
    },
    {
      filename: at("apps/api/src/booking/booking.controller.ts"),
      code: "import { SimulatedCoreBanking } from '../adapters/simulated/core-banking';",
      errors: [{ messageId: "adapterImport" }],
    },
  ],
});

ruleTester.run("no-status-only-assertion", asRule(noStatusOnlyAssertion), {
  valid: [
    {
      filename: at("apps/api/test/booking.e2e-spec.ts"),
      code: "it('books', async () => { const r = await request(app).post('/b').expect(201); expect(r.body.status).toBe('DISBURSED'); });",
    },
    {
      filename: at("apps/api/test/roles.e2e-spec.ts"),
      code: "it('approver cannot book', async () => { await request(app).post('/b').expect(403); });",
    },
    {
      filename: at("apps/api/test/x.e2e-spec.ts"),
      code: "it('ok', async () => { await request(app).get('/h').expect(200).expect({ ok: true }); });",
    },
  ],
  invalid: [
    {
      filename: at("apps/api/test/booking.e2e-spec.ts"),
      code: "it('books', async () => { await request(app).post('/b').expect(201); });",
      errors: [{ messageId: "statusOnly" }],
    },
  ],
});

ruleTester.run("no-raw-colour", asRule(noRawColour), {
  valid: [
    { filename: WEB, code: "const c = <div className='bg-gold-500 text-ink-900' />;" },
    { filename: WEB, code: "const a = <a href='#main-content'>Skip</a>;" },
    { filename: at("packages/ui/src/tokens.test.tsx"), code: "const c = '#fff';" },
  ],
  invalid: [
    {
      filename: WEB,
      code: "const c = <div className='bg-[#D88728]' />;",
      errors: [{ messageId: "raw" }],
    },
    {
      filename: WEB,
      code: "const c = <div style={{ color: 'rgb(0,0,0)' }} />;",
      errors: [{ messageId: "raw" }],
    },
    {
      filename: at("packages/ui/src/badge.tsx"),
      code: "const c = { color: '#1E1E29' };",
      errors: [{ messageId: "raw" }],
    },
  ],
});

ruleTester.run("money-through-formatter", asRule(moneyThroughFormatter), {
  valid: [
    { filename: WEB, code: "const s = <span>{formatPeso(loan.principal)}</span>;" },
    {
      filename: at("apps/backoffice/src/lib/format.ts"),
      code: "const f = new Intl.NumberFormat('en-PH'); const p = '₱';",
    },
  ],
  invalid: [
    { filename: WEB, code: "const s = <span>₱{amount}</span>;", errors: [{ messageId: "peso" }] },
    { filename: WEB, code: "const s = `₱${amount}`;", errors: [{ messageId: "peso" }] },
    {
      filename: WEB,
      code: "const s = Number(amount).toLocaleString();",
      errors: [{ messageId: "localeFormat" }],
    },
    {
      filename: WEB,
      code: "const f = new Intl.NumberFormat('en-PH');",
      errors: [{ messageId: "localeFormat" }],
    },
  ],
});

ruleTester.run(
  "no-case-status-assignment-outside-lifecycle",
  asRule(noCaseStatusAssignmentOutsideLifecycle),
  {
    valid: [
      {
        filename: at("packages/base/src/cases/lifecycle.ts"),
        code: "function moveTo(c, e, to) { c.status = to; }",
      },
      {
        filename: at("packages/base/src/cases/cases.service.ts"),
        code: "moveTo(c, 'APPROVE', CaseStatus.Offer);",
      },
      {
        filename: at("packages/base/src/cases/booking.service.ts"),
        code: "booking.status = 'BOOKED';",
      },
      {
        filename: at("apps/api/test/x.e2e-spec.ts"),
        code: "c.status = CaseStatus.Offer;",
      },
    ],
    invalid: [
      {
        filename: at("packages/base/src/cases/cases.service.ts"),
        code: "c.status = CaseStatus.Offer;",
        errors: [{ messageId: "assignment" }],
      },
      {
        filename: at("packages/base/src/cases/booking.service.ts"),
        code: "loanCase.status = to;",
        errors: [{ messageId: "assignment" }],
      },
    ],
  },
);

ruleTester.run("no-arbitrary-text-size", asRule(noArbitraryTextSize), {
  valid: [
    // The type-scale tokens.
    {
      filename: WEB,
      code: `export const A = () => <p className="text-2xs text-title text-display">x</p>;`,
    },
    // Arbitrary non-size text utilities (a colour, a line-height) are not sizes.
    {
      filename: WEB,
      code: `export const A = () => <p className="text-[var(--c)] leading-[19px]">x</p>;`,
    },
    // A string outside any className or cn() is not a class list.
    { filename: WEB, code: `export const note = "set text-[13px] in the design doc";` },
    // Server code and tests are out of scope.
    { filename: API, code: `export const k = cn("text-[13px]");` },
    {
      filename: at("apps/backoffice/test/a.test.tsx"),
      code: `export const A = () => <p className="text-[13px]">x</p>;`,
    },
  ],
  invalid: [
    {
      filename: WEB,
      code: `export const A = () => <p className="font-bold text-[13.5px]">x</p>;`,
      errors: [{ messageId: "arbitrary", data: { token: "text-[13.5px]" } }],
    },
    // Under a variant, in rem or em, and the length: form.
    {
      filename: at("packages/ui/src/components/a.tsx"),
      code: `export const A = () => <p className="md:text-[1.1rem] hover:text-[0.9em] text-[length:var(--s)]">x</p>;`,
      errors: [{ messageId: "arbitrary" }, { messageId: "arbitrary" }, { messageId: "arbitrary" }],
    },
    // Inside cn(), a template literal and a ternary in a className expression.
    {
      filename: WEB,
      code: `export const A = ({ big }) => <p className={cn("p-2", big && "text-[28px]")}>x</p>;`,
      errors: [{ messageId: "arbitrary" }],
    },
    {
      filename: WEB,
      code: "export const A = ({ t }) => <p className={`${t} text-[15px]`}>x</p>;",
      errors: [{ messageId: "arbitrary" }],
    },
    {
      filename: WEB,
      code: `export const A = ({ on }) => <p className={on ? "text-[11px]" : "text-xs"}>x</p>;`,
      errors: [{ messageId: "arbitrary" }],
    },
    // cn() outside JSX, building a class constant.
    {
      filename: WEB,
      code: `export const k = cn("rounded", "text-[12.5px]");`,
      errors: [{ messageId: "arbitrary" }],
    },
  ],
});

const DTO = at("packages/base/src/cases/dto.ts");
const CV = `import { IsArray, IsObject, IsOptional, ValidateNested } from "class-validator";\nimport { Type } from "class-transformer";\n`;

ruleTester.run("require-shape-with-validate-nested", asRule(requireShapeWithValidateNested), {
  valid: [
    {
      filename: DTO,
      code: `${CV}class D { @IsOptional() @IsObject() @ValidateNested() @Type(() => C) consent?: C; }`,
    },
    {
      filename: DTO,
      code: `${CV}class D { @IsArray() @ValidateNested({ each: true }) @Type(() => L) lines!: L[]; }`,
    },
    {
      filename: DTO,
      code: `import * as cv from "class-validator";\nimport * as ct from "class-transformer";\nclass D { @cv.IsObject() @cv.ValidateNested() @ct.Type(() => C) c!: C; }`,
    },
    { filename: DTO, code: `${CV}class D { @IsOptional() @IsObject() plain?: object; }` },
    { filename: WEB, code: `class D { @ValidateNested() c!: C; }` },
    {
      filename: DTO,
      code: `${CV}class D {\n  // eslint-disable-next-line rule-to-test/require-shape-with-validate-nested -- test\n  @ValidateNested() c!: C;\n}`,
    },
  ],
  invalid: [
    // The consent DTO as staged: @Type but no @IsObject, so an array passes.
    {
      filename: DTO,
      code: `${CV}class D { @IsOptional() @ValidateNested() @Type(() => C) consent?: C; }`,
      errors: [{ messageId: "missingShape" }],
    },
    {
      filename: DTO,
      code: `${CV}class D { @IsObject() @ValidateNested() consent!: C; }`,
      errors: [{ messageId: "missingType" }],
    },
    {
      filename: DTO,
      code: `${CV}class D { @ValidateNested() consent!: C; }`,
      errors: [{ messageId: "missingType" }, { messageId: "missingShape" }],
    },
    // An aliased import is the same decorator.
    {
      filename: DTO,
      code: `import { ValidateNested as Nested } from "class-validator";\nclass D { @Nested() c!: C; }`,
      errors: [{ messageId: "missingType" }, { messageId: "missingShape" }],
    },
    // A namespace import is the same decorator.
    {
      filename: DTO,
      code: `import * as cv from "class-validator";\nclass D { @cv.ValidateNested() c!: C; }`,
      errors: [{ messageId: "missingType" }, { messageId: "missingShape" }],
    },
    // In apps/api too.
    {
      filename: at("apps/api/src/simulation/dto.ts"),
      code: `import { ValidateNested } from "class-validator";\nclass D { @ValidateNested() c!: C; }`,
      errors: [{ messageId: "missingType" }, { messageId: "missingShape" }],
    },
  ],
});

ruleTester.run("no-server-env-in-client", asRule(noServerEnvInClient), {
  valid: [
    {
      filename: at("apps/backoffice/src/app/api/[...path]/route.ts"),
      code: `import { env } from "@/config/env";`,
    },
    {
      filename: at("apps/backoffice/src/middleware.ts"),
      code: `import { env } from "./config/env";`,
    },
    { filename: at("apps/backoffice/src/lib/api.ts"), code: `import { x } from "@/lib/env";` },
    { filename: at("apps/backoffice/test/api-route.test.ts"), code: `import "@/config/env";` },
    { filename: API, code: `import { env } from "../config/env";` },
    {
      filename: WEB,
      code: `// eslint-disable-next-line rule-to-test/no-server-env-in-client -- server component\nimport { env } from "@/config/env";`,
    },
  ],
  invalid: [
    {
      filename: at("apps/backoffice/src/components/x.tsx"),
      code: `"use client";\nimport { env } from "@/config/env";`,
      errors: [{ messageId: "clientImport" }],
    },
    {
      filename: at("apps/backoffice/src/lib/api.ts"),
      code: `import { env } from "../config/env.ts";`,
      errors: [{ messageId: "clientImport" }],
    },
    {
      filename: WEB,
      code: "export { env } from '@/config/env';\nexport * from '../../config/env/index';",
      errors: [{ messageId: "clientImport" }, { messageId: "clientImport" }],
    },
    {
      filename: at("apps/backoffice/src/lib/x.ts"),
      code: "const a = import(`@/config/env`);\nconst b = require('../config/env');",
      errors: [{ messageId: "clientImport" }, { messageId: "clientImport" }],
    },
    {
      // A file merely named route.ts outside app/ is not a route handler.
      filename: at("apps/backoffice/src/lib/route.ts"),
      code: `import { env } from "@/config/env";`,
      errors: [{ messageId: "clientImport" }],
    },
  ],
});

const CONTROLLER = at("packages/base/src/cases/cases.controller.ts");

ruleTester.run("no-money-parse-in-controller", asRule(noMoneyParseInController), {
  valid: [
    // The guarded parse in a service (cases.service.ts parseAmount).
    {
      filename: at("packages/base/src/cases/cases.service.ts"),
      code: "function parseAmount(raw) { try { return Money.of(raw); } catch { return null; } }",
    },
    // A constant literal cannot be attacker-shaped.
    { filename: CONTROLLER, code: `const floor = Money.of("0.00");` },
    // Outside server code.
    {
      filename: at("apps/backoffice/src/app/quote.controller.ts"),
      code: "const a = Money.of(query.amount);",
    },
    // Another class's `of`.
    { filename: CONTROLLER, code: "const a = Decimal.of(query.amount);" },
    {
      filename: CONTROLLER,
      code: "// eslint-disable-next-line rule-to-test/no-money-parse-in-controller -- proven\nconst a = Money.of(q.amount);",
    },
  ],
  invalid: [
    // GET /products/PL/quote as staged: `amount=.` passes @IsDecimal, Money.of throws, 500.
    {
      filename: CONTROLLER,
      code: "class C { quote(query) { const amount = Money.of(query.amount); return amount; } }",
      errors: [{ messageId: "moneyOfInController" }],
    },
    {
      filename: CONTROLLER,
      code: `const a = Money["of"](raw);`,
      errors: [{ messageId: "moneyOfInController" }],
    },
    {
      filename: at("apps/api/src/simulation/simulation.controller.ts"),
      code: "const a = Money.of(`${x}`);",
      errors: [{ messageId: "moneyOfInController" }],
    },
  ],
});

ruleTester.run("problem-code-through-constant", asRule(problemCodeThroughConstant), {
  valid: [
    { filename: WEB, code: "if (err.code === ProblemCode.InvalidTransition) run();" },
    { filename: WEB, code: "const r = c.reasonCodes.some((r) => r.code === 'R10');" },
    { filename: WEB, code: "if (a.status === 'BOOKING_FAILED') run();" },
    {
      filename: at("packages/base/src/cases/cases.service.ts"),
      code: "if (err.code === 'INVALID_STATE_TRANSITION') run();",
    },
    {
      filename: at("apps/backoffice/test/escalation-actions.test.tsx"),
      code: "if (err.code === 'INVALID_STATE_TRANSITION') run();",
    },
    {
      filename: WEB,
      code: "// eslint-disable-next-line rule-to-test/problem-code-through-constant -- not a problem code\nif (x.code === 'SOME_CODE') run();",
    },
  ],
  invalid: [
    {
      filename: WEB,
      code: "if (err instanceof ApiError && err.code === 'INVALID_STATE_TRANSITION') run();",
      errors: [{ messageId: "literal" }],
    },
    {
      filename: WEB,
      code: "const held = a.blockedBy !== `COMPLIANCE_HOLD`;",
      errors: [{ messageId: "literal" }],
    },
    {
      filename: WEB,
      code: "const x = 'AUTHORITY_LIMIT' == (e as ApiError).code;",
      errors: [{ messageId: "literal" }],
    },
    {
      filename: WEB,
      code: "switch (err?.code) { case 'SCREENING_MATCH': break; case ProblemCode.AuthorityLimit: break; }",
      errors: [{ messageId: "literal" }],
    },
    {
      filename: at("packages/ui/src/components/thing.tsx"),
      code: "const y = e['code'] === 'COMPLIANCE_HOLD';",
      errors: [{ messageId: "literal" }],
    },
  ],
});

// Screens never re-derive case state from reason codes: R17 (fraud check unavailable) was
// missed by the next-action text that tested for R10 and R13 (lesson ui-ux-20261128-no-reason-code-mirror).
const PANEL = at("apps/backoffice/src/components/case/actions-panel.tsx");
ruleTester.run("no-reason-code-literal", asRule(noReasonCodeLiteral), {
  valid: [
    // Asking the API's view instead.
    {
      filename: PANEL,
      code: `const offered = c.allowedActions.some((a) => a.action === "REDECIDE" && a.enabled);`,
    },
    // Displaying the codes the API sent.
    { filename: PANEL, code: `const L = ({ r }) => <span className="font-mono">{r.code}</span>;` },
    // An object key that happens to look like a code.
    { filename: PANEL, code: `const legend = { R10: "x" };` },
    // Not a code: "R1" (one digit) and "RS-PL-1".
    { filename: PANEL, code: `const v = x === "R1" || y === "RS-PL-1";` },
    // Outside the path gate: the engine owns its codes.
    {
      filename: at("packages/base/src/decisioning/engine/reason-codes.ts"),
      code: `export const R = { code: "R10" };`,
    },
    // Tests may name codes.
    { filename: at("apps/backoffice/test/actions-panel.test.tsx"), code: `expect(x).toBe("R10");` },
  ],
  invalid: [
    // The shape that bit us.
    {
      filename: PANEL,
      code: `const out = c.decision?.reasonCodes.some((r) => r.code === "R10" || r.code === "R13");`,
      errors: [{ messageId: "literal" }, { messageId: "literal" }],
    },
    // Hoisted into a constant list.
    {
      filename: PANEL,
      code: `const OUTAGE = new Set(["R10", "R13"]);`,
      errors: [{ messageId: "literal" }, { messageId: "literal" }],
    },
    // A switch over codes.
    {
      filename: PANEL,
      code: `switch (r.code) { case "R17": break; }`,
      errors: [{ messageId: "literal" }],
    },
    // A template literal spelling.
    { filename: PANEL, code: "const c = `R13`;", errors: [{ messageId: "literal" }] },
    // A computed key is a lookup, not a label.
    { filename: PANEL, code: `const m = { ["R10"]: 1 };`, errors: [{ messageId: "literal" }] },
    // In packages/ui too.
    {
      filename: at("packages/ui/src/components/pill.tsx"),
      code: `const outage = codes.includes("R10");`,
      errors: [{ messageId: "literal" }],
    },
  ],
});

ruleTester.run("money-column-numeric", asRule(moneyColumnNumeric), {
  valid: [
    {
      filename: WEB,
      code: "const c = [{ key: 'a', header: 'Amount', numeric: true, render: (r) => formatPeso(r.a) }];",
    },
    { filename: WEB, code: "const c = [{ key: 'n', header: 'Name', render: (r) => r.name }];" },
    {
      filename: at("packages/base/src/reports/x.ts"),
      code: "const c = [{ header: 'Amount', render: (r) => formatPeso(r.a) }];",
    },
    {
      filename: WEB,
      code: "const c = [{\n header: 'Note',\n // eslint-disable-next-line rule-to-test/money-column-numeric -- prose\n render: (r) => `Paid ${formatPeso(r.a)} late`,\n}];",
    },
  ],
  invalid: [
    {
      filename: WEB,
      code: "const c = [{ key: 'a', header: 'Amount', render: (r) => formatPeso(r.a) }];",
      errors: [{ messageId: "notNumeric" }],
    },
    {
      filename: WEB,
      code: "const c = [{ header: 'Amount', numeric: false, render: (r) => <span>{formatPeso(r.a)}</span> }];",
      errors: [{ messageId: "notNumeric" }],
    },
    {
      filename: WEB,
      code: "function amounts(a, b) { return <p>{formatPeso(a)} {formatPeso(b)}</p>; }\nconst c = [{ header: 'Amounts', render: (f) => amounts(f.a, f.b) }];",
      errors: [{ messageId: "notNumeric" }],
    },
    {
      filename: WEB,
      code: "const peso = (x) => formatPeso(x);\nconst two = (x) => peso(x);\nconst c = [{ header: 'Amount', render: (f) => two(f.a) }];",
      errors: [{ messageId: "notNumeric" }],
    },
  ],
});

// Screens never key on engine versions: the decision panel's band table stopped at RS-PL-2 and
// RS-PL-3 decisions lost their score band (lesson ui-ux-20261128-no-engine-version-table).
const DPANEL = at("apps/backoffice/src/components/case/decision-panel.tsx");
ruleTester.run("no-engine-version-literal", asRule(noEngineVersionLiteral), {
  valid: [
    // Reading what the API sends.
    { filename: DPANEL, code: `const bands = decision.scoreBand;` },
    // Displaying the version the record carries.
    { filename: DPANEL, code: `const V = ({ d }) => <span>{d.ruleSetVersion}</span>;` },
    // Not a version: a reason code, a product code.
    { filename: DPANEL, code: `const a = "R10x"; const b = "PL";` },
    // Outside the path gate: the engine owns its versions.
    {
      filename: at("packages/base/src/decisioning/engine/rule-sets.ts"),
      code: `const RS = { version: "RS-PL-3" };`,
    },
    // Tests may name versions.
    { filename: at("apps/backoffice/test/decision-band.test.tsx"), code: `const v = "RS-PL-3";` },
  ],
  invalid: [
    // The shape that bit us: a table keyed by version.
    {
      filename: DPANEL,
      code: `const BANDS = { "RS-PL-1": { a: 1 }, "RS-PL-2": { a: 1 } };`,
      errors: [{ messageId: "literal" }, { messageId: "literal" }],
    },
    // A branch on the version.
    {
      filename: DPANEL,
      code: `const old = d.ruleSetVersion === "RS-PL-1";`,
      errors: [{ messageId: "literal" }],
    },
    // A scorecard version, in a template literal.
    { filename: DPANEL, code: "const s = `SC-PL-2`;", errors: [{ messageId: "literal" }] },
    // In packages/ui too.
    {
      filename: at("packages/ui/src/components/score-band.tsx"),
      code: `switch (v) { case "RS-PL-3": break; }`,
      errors: [{ messageId: "literal" }],
    },
  ],
});
