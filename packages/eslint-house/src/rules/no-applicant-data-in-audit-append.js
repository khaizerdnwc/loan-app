/**
 * @fileoverview A direct audit-log entry (`audit.append`) names records by id or reference,
 * never by the applicant's personal data.
 *
 * The audit log is hash-chained and insert-only (triggers refuse UPDATE, DELETE and
 * TRUNCATE), so anything written into it can never be redacted. Entries that are not case
 * events (`APPLICANT_CAPTURED`, intake uploads and discards, reconciliation runs) identify
 * what they touched by id or reference ("Captured applicant <id>"). Lane D batch 1 wrote the
 * uploaded file's name into INTAKE_UPLOADED and INTAKE_DRAFT_DISCARDED — for an email bundle
 * that is the sender's e-mail address. AGENTS.md §2.8: no applicant data in logs.
 *
 * Case events go through `ActivityService.record`, whose case history shows the applicant by
 * design; this rule covers the direct `*.append(...)` call on an audit service only.
 *
 * Scope: server code. The `actor` property (the staff member) is not inspected.
 *
 * Opt out where the value is genuinely not applicant data:
 *   // eslint-disable-next-line house/no-applicant-data-in-audit-append -- <why>
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

/** Field names that carry an applicant's personal data or a file name that may embed it. */
const FORBIDDEN = new Set([
  "fullName",
  "firstName",
  "lastName",
  "birthDate",
  "dateOfBirth",
  "governmentId",
  "governmentIdLast4",
  "email",
  "emailAddress",
  "phone",
  "mobile",
  "address",
  "fileName",
  "employer",
  "monthlyIncome",
  "declaredMonthlyIncome",
  "documentMonthlyIncome",
]);

/** `audit.append`, `this.audit.append`, `this.auditService.append`, `deps.audit.append`. */
function isAuditAppend(callee) {
  if (callee.type !== "MemberExpression") return false;
  const prop = callee.property;
  const name =
    prop.type === "Identifier" && !callee.computed
      ? prop.name
      : prop.type === "Literal"
        ? prop.value
        : null;
  if (name !== "append") return false;
  const obj = callee.object;
  const objName =
    obj.type === "Identifier"
      ? obj.name
      : obj.type === "MemberExpression" && obj.property.type === "Identifier"
        ? obj.property.name
        : "";
  return /audit/i.test(objName);
}

function keyName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Direct audit-log entries name records by id or reference, never by applicant personal data or file names.",
      owner: "security",
    },
    schema: [],
    messages: {
      applicantData:
        "`{{name}}` reaches the hash-chained audit log, which can never be redacted (AGENTS.md " +
        "§2.8). Name the record by id or reference instead (as APPLICANT_CAPTURED does: " +
        '"Captured applicant <id>"), and keep the value in its own table. If it is truly not ' +
        "applicant data: `// eslint-disable-next-line house/no-applicant-data-in-audit-append -- <why>`.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel)) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** Resolve an identifier to its `const` initialiser in scope, one level deep. */
    function initOf(identifier) {
      let scope = sourceCode.getScope ? sourceCode.getScope(identifier) : context.getScope();
      while (scope) {
        const v = scope.set.get(identifier.name);
        if (v) {
          const def = v.defs[0];
          if (def && def.type === "Variable" && def.node.init && def.parent?.kind === "const") {
            return def.node.init;
          }
          return null;
        }
        scope = scope.upper;
      }
      return null;
    }

    function inspect(node, seen) {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      switch (node.type) {
        case "Identifier": {
          if (FORBIDDEN.has(node.name)) {
            context.report({ node, messageId: "applicantData", data: { name: node.name } });
            return;
          }
          const init = initOf(node);
          if (init) inspectFrom(node, init, seen);
          return;
        }
        case "MemberExpression": {
          const name = node.computed ? keyName(node.property) : node.property.name;
          if (name && FORBIDDEN.has(name)) {
            context.report({ node, messageId: "applicantData", data: { name } });
            return;
          }
          inspect(node.object, seen);
          if (node.computed) inspect(node.property, seen);
          return;
        }
        case "Property": {
          const k = node.computed ? null : keyName(node.key);
          if (k === "actor") return;
          if (k && FORBIDDEN.has(k)) {
            context.report({ node: node.key, messageId: "applicantData", data: { name: k } });
            return;
          }
          if (node.computed) inspect(node.key, seen);
          inspect(node.value, seen);
          return;
        }
        default:
          for (const key of Object.keys(node)) {
            if (key === "parent" || key === "loc" || key === "range") continue;
            const child = node[key];
            if (Array.isArray(child)) for (const c of child) inspect(c, seen);
            else if (child && typeof child.type === "string") inspect(child, seen);
          }
      }
    }

    /** A const built earlier: report at the use site so the call is what gets flagged. */
    function inspectFrom(useSite, init, seen) {
      const findings = [];
      walk(init, seen, findings);
      for (const name of new Set(findings)) {
        context.report({ node: useSite, messageId: "applicantData", data: { name } });
      }
    }

    function walk(node, seen, findings) {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (node.type === "Identifier" && FORBIDDEN.has(node.name)) {
        findings.push(node.name);
        return;
      }
      if (node.type === "MemberExpression") {
        const name = node.computed ? keyName(node.property) : node.property.name;
        if (name && FORBIDDEN.has(name)) {
          findings.push(name);
          return;
        }
      }
      for (const key of Object.keys(node)) {
        if (key === "parent" || key === "loc" || key === "range") continue;
        const child = node[key];
        if (Array.isArray(child)) for (const c of child) walk(c, seen, findings);
        else if (child && typeof child.type === "string") walk(child, seen, findings);
      }
    }

    return {
      CallExpression(node) {
        if (!isAuditAppend(node.callee)) return;
        const seen = new Set();
        for (const arg of node.arguments) {
          if (arg.type === "ObjectExpression" || arg.type === "Identifier") inspect(arg, seen);
        }
      },
    };
  },
};
