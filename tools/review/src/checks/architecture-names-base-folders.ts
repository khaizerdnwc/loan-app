/**
 * Every top-level folder under packages/base/src is named in docs/ARCHITECTURE.md.
 *
 * The architecture doc is the map reviewers and agents read to place code and to know which
 * folder may import which. A new folder (a new domain area) that the map never mentions has
 * no stated edges, and the architecture reviewer kept finding the same omission by hand (the
 * features/ review). The doc names a folder as `name/` (in the module tree or the text).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HouseCheck } from "./_registry";

const BASE_SRC = "packages/base/src";
const DOC = "docs/ARCHITECTURE.md";

/** The folders a doc names, as `name/` anywhere in its text. */
export function foldersNamed(doc: string, folders: string[]): Set<string> {
  return new Set(
    folders.filter((f) => new RegExp(`(^|[^A-Za-z0-9_-])${f.replace(/[-]/g, "\\-")}/`).test(doc)),
  );
}

const check: HouseCheck = {
  id: "architecture-names-base-folders",
  description: "every top-level folder under packages/base/src is named in docs/ARCHITECTURE.md",
  devOnly: true,
  run(ctx) {
    const srcDir = join(ctx.repoRoot, BASE_SRC);
    if (!existsSync(srcDir)) return [];
    const docPath = join(ctx.repoRoot, DOC);
    if (!existsSync(docPath)) {
      return [{ file: DOC, message: `missing: it must name each folder of ${BASE_SRC}` }];
    }
    const folders = readdirSync(srcDir).filter((name) =>
      statSync(join(srcDir, name)).isDirectory(),
    );
    const named = foldersNamed(readFileSync(docPath, "utf8"), folders);
    return folders
      .filter((f) => !named.has(f))
      .map((f) => ({
        file: DOC,
        message: `${BASE_SRC}/${f}/ is not named in ${DOC}: add it to the module map with what it does, what it imports and who imports it`,
      }));
  },
};

export default check;
