# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/index.test.ts`.

## Rules

- Coverage targets must meet or exceed 80%.
- Tests must be deterministic (no real network or timers).
- Assertions focus on observable behavior (return values, thrown errors).

## Coverage

- **Parser compliance**: Validates parsing of LF, CR, CRLF, BOM stripping, comment lines, field parsing, and event dispatching.
- **Chunking**: Verifies single-byte splitting and multi-byte UTF-8 character splitting across chunks.
- **Provider Normalization**: Confirms logic for OpenAI, Anthropic, and Gemini delta extraction.
- **Resilience**: Tests reconnection logic, `Last-Event-ID` state retention, and retry thresholds.
- **Errors**: Validates `LINE_TOO_LONG`, `EVENT_TOO_LARGE`, `INVALID_JSON`, and `RETRIES_EXHAUSTED` conditions.
