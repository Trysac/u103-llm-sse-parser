# Stack

## Used

| Tool | Purpose |
|---|---|
| TypeScript | Strict language and type definitions |
| Node.js 20+ | Runtime environment |
| Vitest | Test runner and coverage collection |
| Biome | Linting and code formatting |
| Gitleaks | Secret scanning |

## Discarded

| Tool | Why not |
|---|---|
| ESLint + Prettier | Redundant; Biome handles both concerns efficiently. |
| Jest | Requires extra ESM/TypeScript transpilation steps; slower. |
| Bundlers | Unnecessary complexity for a minimal ESM library. |
