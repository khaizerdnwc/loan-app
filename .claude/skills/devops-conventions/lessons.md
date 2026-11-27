# DevOps lessons

Ungated lessons only, one per line, newest first. Load only the ones for your files: `pnpm lessons for <files> --role devops`. Full story: `pnpm lessons show <id>`. Enforced lessons are not listed; the rule's message is the lesson.

- [devops-20261127-shared-config-in-turbo-global-deps] paths: tools/jest/**, turbo.json, */*/jest.config.js · shape: check-candidate · Config shared by packages but owned by none goes in turbo.json globalDependencies, or caching and --affected skip it. Check: out-of-package requires.
