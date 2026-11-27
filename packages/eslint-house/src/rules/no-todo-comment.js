/**
 * @fileoverview TODO/FIXME/HACK/XXX markers are untracked work.
 *
 * In a weekend build they are also unreviewed promises: the panel reads the code, and a
 * TODO in money or permission code says "not finished" without saying what is missing.
 * Finish it, or record the gap in docs/BUILD-STATUS.md (and the design notes' limitations)
 * where it is visible and owned.
 *
 * Scope: product source under apps/* and packages/* (not tests, not this package).
 */
import { filenameOf, isProductCode, repoRelative } from "../_app-path.js";

const MARKER = /\b(TODO|FIXME|HACK|XXX)\b/;

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow TODO/FIXME/HACK/XXX markers in product source.",
      owner: "architecture",
    },
    schema: [],
    messages: {
      todo:
        "`{{marker}}` is untracked work. Finish it now, or record the gap in docs/BUILD-STATUS.md " +
        "(and the limitations in the design notes) and delete the marker.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isProductCode(rel)) return {};
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const m = MARKER.exec(comment.value);
          if (m) context.report({ loc: comment.loc, messageId: "todo", data: { marker: m[1] } });
        }
      },
    };
  },
};
