# Architecture

## Overview

`@trysac/llm-sse-parser` is a dependency-free TypeScript library for parsing Server-Sent Events according to the WHATWG HTML Living Standard (section 9.2.6).

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API containing the `SseParser`, `parseSse`, `toTextDeltas`, `reconnecting`, and error definitions. |

## Boundaries

- Zero runtime dependencies.
- No I/O during import.
- All inputs are validated against defined constraints.

## Build and distribution

Built via `tsc` to produce ESM modules. Published as a clean package containing only the `dist/` directory.
