# @trysac/llm-sse-parser

Spec-compliant Server-Sent Events parser for LLM streams with byte-safe chunking, typed Anthropic, OpenAI, and Gemini text deltas, and Last-Event-ID reconnection.

## The Problem

Most LLM SDKs implement custom SSE parsing that fails on edge cases like splitting UTF-8 characters across network chunks, mishandling CR line endings, or lacking memory limits. Applications calling these providers directly need a correct, specification-compliant parser that handles multi-provider text normalization and resilient reconnection.

## Installation

```bash
npm install @trysac/llm-sse-parser
```

## Usage

```typescript
import { parseSse, toTextDeltas } from "@trysac/llm-sse-parser";

const stream = parseSse(response.body!);
for await (const part of toTextDeltas("openai", stream)) {
  if (part.type === "text") process.stdout.write(part.text);
  if (part.type === "done") console.log(`Finished: ${part.reason}`);
}
```

## API Overview

- `SseParser`: Incremental parser for raw bytes or strings. Supports `maxLineBytes` and `maxEventBytes` configuration.
- `parseSse`: Async generator that converts an `AsyncIterable` of chunks into an `AsyncIterable<SseEvent>`.
- `toTextDeltas`: Normalizes SSE event streams for `openai`, `anthropic`, or `gemini` into `text`, `done`, or `error` parts.
- `reconnecting`: Runner for persistent connections, handling `Last-Event-ID` and retries.
- `SseError`: Error class providing codes `LINE_TOO_LONG`, `EVENT_TOO_LARGE`, `INVALID_JSON`, `RETRIES_EXHAUSTED`, and `INVALID_OPTIONS`.

## Why not EventSource or standard parsers?

Standard browser `EventSource` cannot access the underlying response body for streaming LLM outputs, nor does it support non-standard retry behaviors or provider-specific JSON delta extraction. This library provides byte-level control and memory safety.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and limits.
