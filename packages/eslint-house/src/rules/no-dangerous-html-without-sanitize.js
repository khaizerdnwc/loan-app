/**
 * @fileoverview Forbids `dangerouslySetInnerHTML` unless `__html` is wrapped in
 * the project's `sanitizeHtml()` helper from `@/lib/sanitize/html`.
 *
 * XSS is trivially introduced when raw user content is injected as HTML. This
 * rule ensures every `dangerouslySetInnerHTML` usage goes through a sanitizer.
 * The only accepted wrappers are call expressions whose callee is (or ends with)
 * `sanitizeHtml` or `sanitizeHtmlStrict` — both exported from `@/lib/sanitize/html`.
 *
 * Correct:
 *   <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }} />
 * Wrong:
 *   <div dangerouslySetInnerHTML={{ __html: raw }} />
 *   <div dangerouslySetInnerHTML={{ __html: raw.replace(...) }} />
 */

const SAFE_FUNCTION_NAMES = new Set(["sanitizeHtml", "sanitizeHtmlStrict"]);

function isSafeSanitizerCall(node) {
  if (node?.type !== "CallExpression") return false;
  const { callee } = node;
  // Direct call: sanitizeHtml(...)
  if (callee.type === "Identifier" && SAFE_FUNCTION_NAMES.has(callee.name)) return true;
  // Member call: html.sanitizeHtml(...) or someModule.sanitizeHtml(...)
  if (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    SAFE_FUNCTION_NAMES.has(callee.property.name)
  )
    return true;
  return false;
}

function getHtmlValueFromObject(objectExpr) {
  if (objectExpr?.type !== "ObjectExpression") return null;
  for (const prop of objectExpr.properties) {
    if (prop.type !== "Property") continue;
    const keyName =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? prop.key.value
          : null;
    if (keyName === "__html") return prop.value;
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require dangerouslySetInnerHTML __html to be wrapped in sanitizeHtml() to prevent XSS.",
    },
    schema: [],
    messages: {
      unsanitized:
        "`dangerouslySetInnerHTML` __html must be wrapped in `sanitizeHtml(...)` or `sanitizeHtmlStrict(...)` " +
        'from "@/lib/sanitize/html". Raw HTML injection is an XSS risk.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        const attrName = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (attrName !== "dangerouslySetInnerHTML") return;

        // value should be JSXExpressionContainer({ __html: expr })
        const container = node.value;
        if (container?.type !== "JSXExpressionContainer") {
          context.report({ node, messageId: "unsanitized" });
          return;
        }

        const htmlValue = getHtmlValueFromObject(container.expression);
        if (htmlValue === null) {
          // Either not an object literal or __html not found — flag it.
          context.report({ node, messageId: "unsanitized" });
          return;
        }

        if (!isSafeSanitizerCall(htmlValue)) {
          context.report({ node, messageId: "unsanitized" });
        }
      },
    };
  },
};
