/**
 * @fileoverview A loan case's status changes only through the lifecycle table.
 *
 * packages/base/src/cases/lifecycle.ts holds the one transition table. `moveTo(c, event, to)`
 * checks both ends of the edge before it writes, and `startDraft(c)` sets a new case's
 * status. A service that assigns `c.status = …` itself skips that check, so a case could
 * move along an edge the table does not draw (architecture review, M3–M7).
 *
 * Flags `x.status = …` in packages/base/src outside lifecycle.ts when the value is a
 * `CaseStatus.*` member or the target looks like a case (`c`, `case…`, `…Case`). Other
 * entities' own status fields (e.g. `booking.status = "BOOKED"`) are not cases and pass.
 */
import { filenameOf, isTestFile, repoRelative } from "../_app-path.js";

const CASE_LIKE = /^(c|case\w*|\w*Case)$/;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Change a loan case's status only through moveTo()/startDraft() in lifecycle.ts.",
      owner: "architecture",
    },
    schema: [],
    messages: {
      assignment:
        "Set a case's status with moveTo(c, event, to) (or startDraft(c) for a new case) from " +
        "cases/lifecycle.ts, so the transition table checks the edge.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!rel.startsWith("packages/base/src/") || isTestFile(rel)) return {};
    if (rel === "packages/base/src/cases/lifecycle.ts") return {};
    return {
      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== "MemberExpression" || left.computed) return;
        if (left.property.type !== "Identifier" || left.property.name !== "status") return;
        const right = node.right;
        const caseStatusValue =
          right.type === "MemberExpression" &&
          right.object.type === "Identifier" &&
          right.object.name === "CaseStatus";
        const caseTarget = left.object.type === "Identifier" && CASE_LIKE.test(left.object.name);
        if (caseStatusValue || caseTarget) context.report({ node, messageId: "assignment" });
      },
    };
  },
};
