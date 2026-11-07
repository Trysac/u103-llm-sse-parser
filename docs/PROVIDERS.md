# Supported LLM Provider SSE Formats

This library standardises Server-Sent Events from major LLM providers into typed deltas:

```typescript
type StreamPart =
  | { type: "text"; text: string }
  | { type: "done"; reason: string | null }
  | { type: "error"; message: string };
```

Checked and verified: 2026-11-06.

## 1. OpenAI Chat Completions

- **Chunk format**: SSE lines with `data: <JSON>`.
- **Content deltas**: `choices[0].delta.content` (yielded as `{ type: "text", text }`).
- **Finish reason**: `choices[0].finish_reason` is tracked.
- **Stream termination**: SSE payload `data: [DONE]` ends the stream with `{ type: "done", reason: lastFinishReason }`.

## 2. Anthropic Messages API

- **Event types**:
  - `content_block_delta`: `delta.type === "text_delta"` contains `delta.text` (yielded as `{ type: "text", text }`).
  - `message_delta`: `delta.stop_reason` is remembered.
  - `message_stop`: Emits `{ type: "done", reason }`.
  - `ping` and other events: Ignored silently.
  - `error`: Yields `{ type: "error", message: "<error.type>: <error.message>" }`.

## 3. Google Gemini (`streamGenerateContent?alt=sse`)

- **Chunk format**: SSE lines with `data: <JSON>`.
- **Content deltas**: Each `candidate.content.parts[].text` in `candidates[0]` is emitted as `{ type: "text", text }`.
- **Finish reason**: `candidates[0].finishReason` is captured.
- **Stream termination**: Stream completion emits `{ type: "done", reason: finishReason }`.
