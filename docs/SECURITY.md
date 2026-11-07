# Security practices

## Threat Model

- **Buffer Exhaustion**: Defended via configurable `maxLineBytes` and `maxEventBytes`. The parser throws `SseError` if these limits are exceeded.
- **Malformed Input**: JSON data in SSE events is parsed safely. Invalid JSON triggers `INVALID_JSON` errors, with payloads truncated to 200 characters to prevent log flooding.
- **Reconnection Cycles**: Defended via `maxRetries` limits and injection of an external sleep function.

## Limits

- `maxLineBytes`: Default 1 MiB. Enforces strict byte-counting to prevent memory growth.
- `maxEventBytes`: Default 4 MiB. Prevents unbounded data accumulation.

## Practices

- No `eval` or dynamic code execution.
- No runtime dependencies.
- Regular dependency audits via Dependabot.
