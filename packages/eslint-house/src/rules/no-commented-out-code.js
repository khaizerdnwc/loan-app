/**
 * @fileoverview Commented-out code is dead code with no owner.
 *
 * It rots (nobody compiles or tests it), it misleads the next reader into thinking it
 * might come back, and git already keeps every deleted line. Delete it.
 *
 * Explanatory "why" comments stay allowed — this only flags comment lines that read like
 * code: a statement ending in `;`, a declaration, a call, an import, a closing brace, JSX.
 * JSDoc blocks (`/**`) are exempt: they may show examples.
 *
 * Scope: product source under apps/* and packages/* (not tests, not this package).
 */
import { filenameOf, isProductCode, repoRelative } from "../_app-path.js";

const DIRECTIVE =
  /^\s*(eslint-|biome-ignore|@ts-|nosemgrep|house-check-disable|prettier-ignore|istanbul|c8 |#region|#endregion|\/ <reference)/;

const CODE_SHAPES = [
  /;\s*$/,
  /^\s*(import|export)\s+[\w{*]/,
  /^\s*(const|let|var|function|class|interface|type|enum|return|await|throw|async)\s+[\w{[(]/,
  /^\s*(if|for|while|switch|catch)\s*\(/,
  /^\s*[}\])]+\s*[;,)]*\s*$/,
  /^\s*[\w$.]+\s*\([^)]*\)\s*[;,]?\s*$/,
  /^\s*[\w$.[\]]+\s*=\s*[^=].*$/,
  /^\s*<\/?[A-Za-z][\w.]*(\s[^>]*)?\/?>\s*$/,
];

export function looksLikeCode(text) {
  const t = text.trim();
  if (!t || DIRECTIVE.test(t)) return false;
  // Prose with a trailing period or question is prose, even with parentheses in it.
  if (/[a-z][.?!:]$/.test(t) && !/[;{}]/.test(t)) return false;
  return CODE_SHAPES.some((re) => re.test(t));
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow commented-out code in product source.",
      owner: "architecture",
    },
    schema: [],
    messages: {
      commentedCode:
        "This comment is commented-out code. Delete it — git keeps the history. If it explains " +
        "something, rewrite it as a sentence saying why.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isProductCode(rel)) return {};
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Block" && comment.value.startsWith("*")) continue;
          const lines = comment.value.split("\n").map((l) => l.replace(/^\s*\*?/, ""));
          if (lines.some(looksLikeCode)) {
            context.report({ loc: comment.loc, messageId: "commentedCode" });
          }
        }
      },
    };
  },
};
