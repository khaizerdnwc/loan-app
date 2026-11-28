/**
 * @fileoverview A nested DTO property states its shape: `@ValidateNested()` comes with
 * `@Type(() => X)` and `@IsObject()` (or `@IsArray()` for a list).
 *
 * `@ValidateNested()` alone accepts an array as readily as an object: class-validator walks
 * each element, so `consent: [ ]` or `consent: [{...}]` passes validation and reaches the
 * service as an array where it expected one object (C-1 consent capture, the first nested
 * DTO in this repo). Without `@Type(...)`, class-transformer never builds the nested class,
 * so the nested whitelist (`forbidNonWhitelisted`) has no metadata to check against. The
 * DTO is the wall the service relies on (AGENTS.md non-negotiable 1, security-conventions
 * "Input and output"), so the shape is declared on the property, not assumed downstream.
 *
 * Opt out where the rule genuinely does not apply:
 *   // eslint-disable-next-line house/require-shape-with-validate-nested -- <why>
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

const VALIDATOR = "class-validator";
const TRANSFORMER = "class-transformer";
const SHAPES = new Set(["IsObject", "IsArray"]);

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "@ValidateNested() is paired with @Type(() => X) and @IsObject() or @IsArray() on the same property.",
      owner: "security",
    },
    schema: [],
    messages: {
      missingType:
        "`{{name}}` has @ValidateNested() but no @Type(() => YourDto) from class-transformer, so " +
        "the nested body is never turned into the DTO class and its fields are not whitelisted. " +
        "Add `@Type(() => YourDto)`.",
      missingShape:
        "`{{name}}` has @ValidateNested() but does not say whether it is one object or a list: " +
        "class-validator accepts an array here too. Add `@IsObject()` for one object, or " +
        "`@IsArray()` (with `@ValidateNested({ each: true })`) for a list, from class-validator.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel)) return {};

    /** local identifier -> imported name, for class-validator / class-transformer. */
    const named = new Map();
    /** namespace identifiers bound to either module. */
    const namespaces = new Set();
    /** decorated class properties, checked once every import is known. */
    const members = [];

    function decoratorName(decorator) {
      let expr = decorator.expression;
      if (expr.type === "CallExpression") expr = expr.callee;
      if (expr.type === "Identifier") return named.get(expr.name) ?? expr.name;
      if (
        expr.type === "MemberExpression" &&
        expr.object.type === "Identifier" &&
        namespaces.has(expr.object.name) &&
        expr.property.type === "Identifier"
      ) {
        return expr.property.name;
      }
      return null;
    }

    function check(member) {
      const decorators = member.decorators ?? [];
      if (decorators.length === 0) return;
      const names = new Set(decorators.map(decoratorName).filter(Boolean));
      if (!names.has("ValidateNested")) return;
      const name =
        member.key && member.key.type === "Identifier" ? member.key.name : "this property";
      const nested = decorators.find((d) => decoratorName(d) === "ValidateNested");
      if (!names.has("Type")) {
        context.report({ node: nested, messageId: "missingType", data: { name } });
      }
      if (![...SHAPES].some((s) => names.has(s))) {
        context.report({ node: nested, messageId: "missingShape", data: { name } });
      }
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source !== VALIDATOR && source !== TRANSFORMER) return;
        for (const spec of node.specifiers) {
          if (spec.type === "ImportNamespaceSpecifier") namespaces.add(spec.local.name);
          if (spec.type === "ImportSpecifier" && spec.imported.type === "Identifier") {
            named.set(spec.local.name, spec.imported.name);
          }
        }
      },
      PropertyDefinition(node) {
        members.push(node);
      },
      TSAbstractPropertyDefinition(node) {
        members.push(node);
      },
      AccessorProperty(node) {
        members.push(node);
      },
      // Decided at the end so an import written after the class still resolves its aliases.
      "Program:exit"() {
        for (const member of members) check(member);
      },
    };
  },
};
