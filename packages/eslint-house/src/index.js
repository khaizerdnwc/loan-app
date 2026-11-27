/**
 * House ESLint rules for the WhiteBank Lending repo (ADR 0015, ADR 0016).
 *
 * One package, loaded by the one root eslint.config.js, so the on-edit hook, preflight,
 * the pre-push gate and the pull request all run the same rules. Biome does the general
 * linting and formatting; these encode what only this project knows. Each rule names the
 * reviewer role that owns it (`meta.docs.owner`). The list below is the documented list:
 * `pnpm house:check` (check:house-rule-parity) fails when a rule is missing from it, from
 * the rules map, from eslint.config.js, or has no RuleTester run with a valid and an
 * invalid case.
 *
 * Rules:
 *   - no-commented-out-code              : commented-out code in product source; delete it
 *   - no-todo-comment                    : TODO/FIXME/HACK/XXX markers are untracked work
 *   - no-console-in-server               : server code logs through Nest's Logger
 *   - no-math-random-in-server           : ids, keys and tokens come from a CSPRNG
 *   - no-money-parse-in-controller       : controllers never Money.of() request input (a 500 on bad input)
 *   - no-process-env-outside-config      : process.env only in apps/<app>/src/config/env.ts
 *   - require-roles-on-controller-handler: every handler declares @Roles(...) or @Public()
 *   - require-shape-with-validate-nested : @ValidateNested() comes with @Type() and @IsObject()/@IsArray()
 *   - no-dangerous-html-without-sanitize : dangerouslySetInnerHTML only through sanitizeHtml()
 *   - no-error-name-branching            : branch on error class or code, never err.name
 *   - no-float-money                     : money is Money (decimal), never number math or float columns
 *   - no-datasource-outside-repository   : DataSource/EntityManager/raw SQL only in repositories
 *   - no-typeorm-synchronize             : schema changes through migrations only
 *   - require-order-with-take            : take/skip/limit come with an explicit order
 *   - no-provider-import-outside-adapters: workflow code depends on ports, not concrete providers
 *   - no-case-status-assignment-outside-lifecycle: a case's status changes only via moveTo()
 *   - no-status-only-assertion           : a success test asserts the outcome, not only 2xx
 *   - no-raw-colour                      : components use theme tokens, never colour literals
 *   - money-through-formatter            : peso amounts are displayed through formatPeso()
 *   - no-ring-color-without-width        : a ring colour needs a ring width to show
 *   - text-size-before-leading           : a text-size class after leading-* resets line height
 *   - no-arbitrary-text-size             : text sizes come from the type scale, never text-[…px]
 *   - no-title-on-disabled-control       : a disabled control's title tooltip never shows
 *   - require-label-in-name              : an aria-label must contain the visible label
 *   - no-server-env-in-client            : the backoffice's config/env only from route handlers and middleware
 *   - problem-code-through-constant      : the backoffice compares err.code / blockedBy with ProblemCode, never a literal
 */
import moneyThroughFormatter from "./rules/money-through-formatter.js";
import noArbitraryTextSize from "./rules/no-arbitrary-text-size.js";
import noCaseStatusAssignmentOutsideLifecycle from "./rules/no-case-status-assignment-outside-lifecycle.js";
import noCommentedOutCode from "./rules/no-commented-out-code.js";
import noConsoleInServer from "./rules/no-console-in-server.js";
import noDangerousHtmlWithoutSanitize from "./rules/no-dangerous-html-without-sanitize.js";
import noDatasourceOutsideRepository from "./rules/no-datasource-outside-repository.js";
import noErrorNameBranching from "./rules/no-error-name-branching.js";
import noFloatMoney from "./rules/no-float-money.js";
import noMathRandomInServer from "./rules/no-math-random-in-server.js";
import noMoneyParseInController from "./rules/no-money-parse-in-controller.js";
import noProcessEnvOutsideConfig from "./rules/no-process-env-outside-config.js";
import noProviderImportOutsideAdapters from "./rules/no-provider-import-outside-adapters.js";
import noRawColour from "./rules/no-raw-colour.js";
import noRingColorWithoutWidth from "./rules/no-ring-color-without-width.js";
import noServerEnvInClient from "./rules/no-server-env-in-client.js";
import noStatusOnlyAssertion from "./rules/no-status-only-assertion.js";
import noTitleOnDisabledControl from "./rules/no-title-on-disabled-control.js";
import noTodoComment from "./rules/no-todo-comment.js";
import noTypeormSynchronize from "./rules/no-typeorm-synchronize.js";
import problemCodeThroughConstant from "./rules/problem-code-through-constant.js";
import requireLabelInName from "./rules/require-label-in-name.js";
import requireOrderWithTake from "./rules/require-order-with-take.js";
import requireRolesOnControllerHandler from "./rules/require-roles-on-controller-handler.js";
import requireShapeWithValidateNested from "./rules/require-shape-with-validate-nested.js";
import textSizeBeforeLeading from "./rules/text-size-before-leading.js";

export default {
  meta: { name: "@loan/eslint-house", version: "0.1.0" },
  rules: {
    "no-commented-out-code": noCommentedOutCode,
    "no-todo-comment": noTodoComment,
    "no-console-in-server": noConsoleInServer,
    "no-math-random-in-server": noMathRandomInServer,
    "no-money-parse-in-controller": noMoneyParseInController,
    "no-process-env-outside-config": noProcessEnvOutsideConfig,
    "require-roles-on-controller-handler": requireRolesOnControllerHandler,
    "require-shape-with-validate-nested": requireShapeWithValidateNested,
    "no-dangerous-html-without-sanitize": noDangerousHtmlWithoutSanitize,
    "no-error-name-branching": noErrorNameBranching,
    "no-float-money": noFloatMoney,
    "no-datasource-outside-repository": noDatasourceOutsideRepository,
    "no-typeorm-synchronize": noTypeormSynchronize,
    "require-order-with-take": requireOrderWithTake,
    "no-provider-import-outside-adapters": noProviderImportOutsideAdapters,
    "no-case-status-assignment-outside-lifecycle": noCaseStatusAssignmentOutsideLifecycle,
    "no-status-only-assertion": noStatusOnlyAssertion,
    "no-raw-colour": noRawColour,
    "money-through-formatter": moneyThroughFormatter,
    "no-ring-color-without-width": noRingColorWithoutWidth,
    "text-size-before-leading": textSizeBeforeLeading,
    "no-arbitrary-text-size": noArbitraryTextSize,
    "no-title-on-disabled-control": noTitleOnDisabledControl,
    "require-label-in-name": requireLabelInName,
    "no-server-env-in-client": noServerEnvInClient,
    "problem-code-through-constant": problemCodeThroughConstant,
  },
};
