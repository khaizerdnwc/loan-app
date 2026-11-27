import { type Rule, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import noRingColorWithoutWidth from "../src/rules/no-ring-color-without-width.js";
import noTitleOnDisabledControl from "../src/rules/no-title-on-disabled-control.js";
import requireLabelInName from "../src/rules/require-label-in-name.js";
import textSizeBeforeLeading from "../src/rules/text-size-before-leading.js";

// ESLint's RuleTester drives the host test runner. Vitest runs with globals: false, so
// wire the hooks explicitly. Ported from nxlvl with their original cases; filenames are
// package-relative ("src/..."), which the _app-path shim maps for every package.
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
  },
});

ruleTester.run("no-ring-color-without-width", asRule(noRingColorWithoutWidth), {
  valid: [
    // Width and colour on the same element, under different variants: they combine.
    {
      filename: "src/components/ui/input.tsx",
      code: `export const I = () => <input className={cn("focus-visible:ring-[3px] focus-visible:ring-ring/50", "aria-invalid:ring-destructive/20")} />;`,
    },
    // The OTP shape: the invalid state carries its own width.
    {
      filename: "src/components/ui/otp-input.tsx",
      code: `export const O = () => <input className="aria-invalid:ring-2 aria-invalid:ring-destructive/60" />;`,
    },
    // A bare ring and ring-offset / ring-inset are not colours.
    {
      filename: "src/features/x/components/a.tsx",
      code: `export const A = ({ s }) => <div className={s && "ring ring-offset-2 ring-inset ring-primary"} />;`,
    },
    // A colour handed to a COMPONENT may lean on the width it ships.
    {
      filename: "src/components/ui/chat-composer.tsx",
      code: `export const C = () => <Textarea className="focus-visible:ring-sky-400/60" />;`,
    },
    // Outside the path gate.
    {
      filename: "scripts/thing.tsx",
      code: `export const S = () => <div className="ring-primary" />;`,
    },
    // Opt-out.
    {
      filename: "src/features/x/components/b.tsx",
      code: `// eslint-disable-next-line rule-to-test/no-ring-color-without-width -- width from [data-selected] css
export const B = () => <div className="ring-primary" />;`,
    },
  ],
  invalid: [
    // The regression that bit us: focus ring swapped for field-glow, width gone.
    {
      filename: "src/components/ui/input.tsx",
      code: `export const I = ({ className }) => <input className={cn("outline-none", "field-glow", "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40", className)} />;`,
      errors: [{ messageId: "colorWithoutWidth" }],
    },
    // A colour behind a conditional, in a template literal.
    {
      filename: "src/features/x/components/c.tsx",
      code: 'export const C = ({ on }) => <div className={`box ${on ? "ring-sky-400/40" : ""}`} />;',
      errors: [{ messageId: "colorWithoutWidth" }],
    },
    // Object-key syntax in cn().
    {
      filename: "src/features/x/components/d.tsx",
      code: `export const D = ({ bad }) => <span className={cn("px-2", { "ring-destructive": bad })} />;`,
      errors: [{ messageId: "colorWithoutWidth" }],
    },
  ],
});

ruleTester.run("text-size-before-leading", asRule(textSizeBeforeLeading), {
  valid: [
    // Size first, then leading: both survive tailwind-merge.
    {
      filename: "src/features/feed/components/a.tsx",
      code: `export const A = () => <p className={cn("text-[15px] leading-snug", "font-bold")} />;`,
    },
    // Different variants don't conflict.
    {
      filename: "src/features/feed/components/a.tsx",
      code: `export const A = () => <p className={cn("leading-tight", "sm:text-xl")} />;`,
    },
    // text-<colour> is not a size.
    {
      filename: "src/features/feed/components/a.tsx",
      code: `export const A = () => <p className={cn("leading-tight", "text-muted-foreground text-white/80")} />;`,
    },
    // A plain className string isn't merged: its order doesn't matter.
    {
      filename: "src/features/feed/components/a.tsx",
      code: `export const A = () => <p className="leading-tight text-sm" />;`,
    },
    // Outside the path gate.
    {
      filename: "scripts/thing.ts",
      code: `cn("leading-tight", "text-sm");`,
    },
    // Ternary branches are alternatives: leading in one, size in the other.
    {
      filename: "src/features/feed/components/a.tsx",
      code: `export const A = ({ sm }) => <p className={cn(sm ? "text-xs leading-none" : "text-sm leading-none")} />;`,
    },
    // The opt-out.
    {
      filename: "src/features/feed/components/a.tsx",
      code: `// eslint-disable-next-line rule-to-test/text-size-before-leading -- the size's own leading is wanted
cn("leading-tight", "text-sm");`,
    },
  ],
  invalid: [
    // The shape that bit us: leading first, a size later in the same cn().
    {
      filename: "src/features/feed/components/a.tsx",
      code: `export const A = ({ big }) => <p className={cn("leading-snug", big && "text-lg")} />;`,
      errors: [{ messageId: "leadingDropped" }],
    },
    // Same string, arbitrary size, under the same variant.
    {
      filename: "src/features/feed/components/a.tsx",
      code: `export const A = () => <p className={cn("md:leading-6 md:text-[15px]")} />;`,
      errors: [{ messageId: "leadingDropped" }],
    },
    // A ternary branch counts.
    {
      filename: "src/features/feed/components/a.tsx",
      code: `export const A = ({ x }) => <p className={cn("leading-none", x ? "text-2xl" : "text-base")} />;`,
      errors: [{ messageId: "leadingDropped" }],
    },
  ],
});

ruleTester.run("no-title-on-disabled-control", asRule(noTitleOnDisabledControl), {
  valid: [
    {
      filename: "src/features/foo/components/a.tsx",
      code: `const A = () => <><Button disabled>Link</Button><p>Linking isn't available yet.</p></>;`,
    },
    {
      filename: "src/features/foo/components/a.tsx",
      code: `const A = ({ busy }) => <Button disabled={busy} title="Refresh">R</Button>;`,
    },
    {
      filename: "src/features/foo/components/a.tsx",
      code: `const A = () => <Button disabled={false} title="Refresh">R</Button>;`,
    },
    {
      filename: "src/features/foo/components/a.tsx",
      code: `const A = () => <span title="Not available"><Button disabled>Link</Button></span>;`,
    },
    {
      filename: "scripts/thing.tsx",
      code: `const A = () => <button disabled title="x">x</button>;`,
    },
  ],
  invalid: [
    {
      filename: "src/features/foo/components/a.tsx",
      code: `const A = () => <Button size="sm" disabled title="Linking isn't available yet">Link</Button>;`,
      errors: [{ messageId: "titleOnDisabled" }],
    },
    {
      filename: "src/features/foo/components/a.tsx",
      code: `const A = () => <button disabled={true} title={reason}>x</button>;`,
      errors: [{ messageId: "titleOnDisabled" }],
    },
    {
      filename: "src/components/ui/a.tsx",
      code: `const A = () => <input title="Locked" disabled="disabled" />;`,
      errors: [{ messageId: "titleOnDisabled" }],
    },
  ],
});

ruleTester.run("require-label-in-name", asRule(requireLabelInName), {
  valid: [
    // No aria-label: the visible text is the name.
    {
      filename: "src/features/feed/components/x.tsx",
      code: `export const P = () => <button type="button">What's going on?</button>;`,
    },
    // The label contains the visible words (case and punctuation ignored).
    {
      filename: "src/features/feed/components/x.tsx",
      code: `export const P = () => <button aria-label="View all upcoming scrims">View all</button>;`,
    },
    // Icon-only child: out of scope (nothing visible to contain).
    {
      filename: "src/features/feed/components/x.tsx",
      code: `export const P = () => <button aria-label="Close"><XIcon /></button>;`,
    },
    // Dynamic text: not guessed.
    {
      filename: "src/features/feed/components/x.tsx",
      code: `export const P = ({ n }) => <button aria-label="Open">{n}</button>;`,
    },
    // A component, not an intrinsic element.
    {
      filename: "src/features/feed/components/x.tsx",
      code: `export const P = () => <Button aria-label="Write a post">Go</Button>;`,
    },
    // Outside the path gate.
    {
      filename: "scripts/x.tsx",
      code: `export const P = () => <button aria-label="Write a post">What's going on?</button>;`,
    },
  ],
  invalid: [
    // The bug: the visible prompt text is replaced as the name.
    {
      filename: "src/features/feed/components/post-composer.tsx",
      code: `
        export function P() {
          return <button aria-label="Write a post">{COMPOSER_PROMPT}</button>;
        }
        export const COMPOSER_PROMPT = "What's going on?";
      `,
      errors: [{ messageId: "labelNotInName" }],
    },
    // Plain text child, label in an expression container.
    {
      filename: "src/features/feed/components/x.tsx",
      code: `export const P = () => <a href="/x" aria-label={"Upcoming"}>View all</a>;`,
      errors: [{ messageId: "labelNotInName" }],
    },
    // A string-literal child.
    {
      filename: "src/features/feed/components/x.tsx",
      code: `export const P = () => <button aria-label="Submit form">{"Post"}</button>;`,
      errors: [{ messageId: "labelNotInName" }],
    },
  ],
});
