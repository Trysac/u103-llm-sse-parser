/**
 * Public entry point and implementation of @trysac/llm-sse-parser.
 *
 * Adheres to WHATWG HTML Living Standard section 9.2.6 (Interpreting an event stream)
 * with byte-safe streaming UTF-8 decoding, protective buffer caps, typed provider
 * text delta mappings (OpenAI, Anthropic, Gemini), and resumable reconnection.
 */

/** Error codes supported by {@link SseError}. */
export type SseErrorCode =
  | "LINE_TOO_LONG"
  | "EVENT_TOO_LARGE"
  | "INVALID_JSON"
  | "RETRIES_EXHAUSTED"
  | "INVALID_OPTIONS";

/**
 * Library error class with machine-readable error codes.
 */
export class SseError extends Error {
  readonly code: SseErrorCode;

  constructor(message: string, code: SseErrorCode) {
    super(message);
    this.name = "SseError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Represents a dispatched Server-Sent Event as specified by WHATWG.
 */
export interface SseEvent {
  /** Event type (defaults to 'message'). */
  event: string;
  /** Payload data with at most one trailing newline stripped upon dispatch. */
  data: string;
  /** Last event ID, persisted across events. */
  id: string;
  /** Reconnection time in milliseconds if specified by the server. */
  retry?: number;
}

/**
 * Configuration options for {@link SseParser}.
 */
export interface SseParserOptions {
  /** Maximum allowed UTF-8 bytes per single line (default: 1,048,576 / 1 MiB). */
  maxLineBytes?: number;
  /** Maximum allowed UTF-8 bytes for buffered event data (default: 4,194,304 / 4 MiB). */
  maxEventBytes?: number;
}

const DEFAULT_MAX_LINE_BYTES = 1_048_576;
const DEFAULT_MAX_EVENT_BYTES = 4_194_304;
const DIGITS_ONLY_REGEX = /^\d+$/;

const textEncoder = new TextEncoder();

function truncateForMessage(input: string, limit = 200): string {
  if (input.length <= limit) {
    return input;
  }
  return `${input.slice(0, limit)}...`;
}

function validatePositiveInteger(value: unknown, name: string): void {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new SseError(`Option "${name}" must be a positive integer.`, "INVALID_OPTIONS");
  }
}

/**
 * Spec-compliant incremental push-based Server-Sent Events parser.
 */
export class SseParser {
  private readonly maxLineBytes: number;
  private readonly maxEventBytes: number;
  private readonly decoder: TextDecoder;

  private lineBuffer = "";
  private currentLineBytes = 0;
  private pendingCarriageReturn = false;
  private isLeadingChunk = true;

  // Event stream state
  private eventType = "";
  private dataBuffer = "";
  private currentDataBytes = 0;
  private lastEventId = "";
  private retryInterval?: number;

  constructor(opts?: SseParserOptions) {
    const maxLine = opts?.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    const maxEvent = opts?.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;

    if (opts?.maxLineBytes !== undefined) {
      validatePositiveInteger(opts.maxLineBytes, "maxLineBytes");
    }
    if (opts?.maxEventBytes !== undefined) {
      validatePositiveInteger(opts.maxEventBytes, "maxEventBytes");
    }

    this.maxLineBytes = maxLine;
    this.maxEventBytes = maxEvent;
    // fatal: false, ignoreBOM: false (strips one leading BOM automatically)
    this.decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
  }

  /**
   * Appends a chunk of binary or string data to the parser, returning any dispatched events.
   */
  push(chunk: Uint8Array | string): SseEvent[] {
    let text: string;
    if (typeof chunk === "string") {
      // Normalize BOM if leading string chunk
      if (this.isLeadingChunk) {
        text = chunk.startsWith("\uFEFF") ? chunk.slice(1) : chunk;
        this.isLeadingChunk = false;
      } else {
        text = chunk;
      }
    } else {
      text = this.decoder.decode(chunk, { stream: true });
      this.isLeadingChunk = false;
    }

    return this.processDecodedText(text);
  }

  /**
   * Signals the end of the input stream. Unterminated events without a closing blank line are discarded.
   */
  end(): SseEvent[] {
    const remainingText = this.decoder.decode(); // flush decoder
    const events: SseEvent[] = [];
    if (remainingText.length > 0) {
      events.push(...this.processDecodedText(remainingText));
    }

    // If there was a pending carriage return from a previous chunk,
    // and there is no more text, the carriage return acted as a line break.
    // However, the line before CR was already processed in processDecodedText when CR was seen!
    // But wait: if the stream ends while pendingCarriageReturn is true, does that mean an empty line?
    // In "data: line1\r\n\r":
    // "data: line1" followed by \r\n -> processLine("data: line1") called.
    // then \r at end of chunk -> pendingCarriageReturn was set to true, and processLine("") was called!
    // So dispatchEvent() was already called during push("data: line1\r\n\r")!
    // But push() returned: did it return the event? Wait! Let's check what happened!
    if (this.lineBuffer.length > 0) {
      // Trailing characters not followed by CR/LF are a final line
      const ev = this.processLine(this.lineBuffer);
      this.lineBuffer = "";
      this.currentLineBytes = 0;
      if (ev) {
        events.push(ev);
      }
    }

    this.dataBuffer = "";
    this.currentDataBytes = 0;
    this.eventType = "";
    this.pendingCarriageReturn = false;
    return events;
  }

  private processDecodedText(text: string): SseEvent[] {
    const events: SseEvent[] = [];
    let i = 0;
    const len = text.length;

    while (i < len) {
      const char = text[i];
      if (char === undefined) {
        break;
      }

      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        if (char === "\n") {
          // CRLF sequence across chunks or characters: LF swallowed
          i++;
          continue;
        }
        // CR was not followed by LF, so the line ended at CR and char is the next line's first char
        // The line ending already fired when CR occurred.
      }

      if (char === "\r") {
        // Check if next char in current text is LF
        if (i + 1 < len) {
          if (text[i + 1] === "\n") {
            i++; // Skip the LF in CRLF
          }
        } else {
          // Wait for next push to check for LF
          this.pendingCarriageReturn = true;
        }

        const ev = this.processLine(this.lineBuffer);
        this.lineBuffer = "";
        this.currentLineBytes = 0;
        if (ev) {
          events.push(ev);
        }
        i++;
      } else if (char === "\n") {
        const ev = this.processLine(this.lineBuffer);
        this.lineBuffer = "";
        this.currentLineBytes = 0;
        if (ev) {
          events.push(ev);
        }
        i++;
      } else {
        this.lineBuffer += char;
        // Byte counting and limit check
        const charBytes = textEncoder.encode(char).length;
        this.currentLineBytes += charBytes;
        if (this.currentLineBytes > this.maxLineBytes) {
          throw new SseError(
            `Line byte limit exceeded (${this.currentLineBytes} > ${this.maxLineBytes})`,
            "LINE_TOO_LONG",
          );
        }
        i++;
      }
    }

    return events;
  }

  private processLine(line: string): SseEvent | null {
    // Blank line indicates dispatch
    if (line.length === 0) {
      return this.dispatchEvent();
    }

    // Comment
    if (line.startsWith(":")) {
      return null;
    }

    let field = "";
    let value = "";
    const colonIndex = line.indexOf(":");

    if (colonIndex === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colonIndex);
      let rawVal = line.slice(colonIndex + 1);
      if (rawVal.startsWith(" ")) {
        rawVal = rawVal.slice(1);
      }
      value = rawVal;
    }

    switch (field) {
      case "event":
        this.eventType = value;
        break;
      case "data": {
        const appended = `${value}\n`;
        const appendedBytes = textEncoder.encode(appended).length;
        if (this.currentDataBytes + appendedBytes > this.maxEventBytes) {
          throw new SseError(
            `Event data buffer exceeded maximum size of ${this.maxEventBytes} bytes.`,
            "EVENT_TOO_LARGE",
          );
        }
        this.dataBuffer += appended;
        this.currentDataBytes += appendedBytes;
        break;
      }
      case "id":
        if (!value.includes("\u0000")) {
          this.lastEventId = value;
        }
        break;
      case "retry":
        if (DIGITS_ONLY_REGEX.test(value)) {
          const parsed = Number.parseInt(value, 10);
          if (Number.isSafeInteger(parsed)) {
            this.retryInterval = parsed;
          }
        }
        break;
      default:
        // Unrecognised fields are ignored according to WHATWG
        break;
    }

    return null;
  }

  private dispatchEvent(): SseEvent | null {
    if (this.dataBuffer.length === 0) {
      this.eventType = "";
      return null;
    }

    let data = this.dataBuffer;
    if (data.endsWith("\n")) {
      data = data.slice(0, -1);
    }

    const event: SseEvent = {
      event: this.eventType.length > 0 ? this.eventType : "message",
      data,
      id: this.lastEventId,
    };
    if (this.retryInterval !== undefined) {
      event.retry = this.retryInterval;
    }

    // Reset event buffer and type
    this.dataBuffer = "";
    this.currentDataBytes = 0;
    this.eventType = "";

    return event;
  }
}

/**
 * Parses an async iterable stream of chunks into an async iterable stream of {@link SseEvent}.
 */
export async function* parseSse(
  stream: AsyncIterable<Uint8Array | string>,
  opts?: SseParserOptions,
): AsyncIterable<SseEvent> {
  const parser = new SseParser(opts);
  for await (const chunk of stream) {
    const events = parser.push(chunk);
    for (const ev of events) {
      yield ev;
    }
  }
  const finalEvents = parser.end();
  for (const ev of finalEvents) {
    yield ev;
  }
}

/**
 * Normalised stream item emitted by {@link toTextDeltas}.
 */
export type StreamPart =
  | { type: "text"; text: string }
  | { type: "done"; reason: string | null }
  | { type: "error"; message: string };

/** Supported LLM provider names. */
export type ProviderName = "anthropic" | "openai" | "gemini";

function parseJsonSafe(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (err) {
    const truncated = truncateForMessage(data, 200);
    const reason = err instanceof Error ? err.message : String(err);
    throw new SseError(`Invalid JSON in SSE data (${reason}): "${truncated}"`, "INVALID_JSON");
  }
}

/**
 * Converts an SSE event stream from Anthropic, OpenAI, or Gemini into normalised text deltas,
 * error messages, or completion indicators.
 */
export async function* toTextDeltas(
  provider: ProviderName,
  events: AsyncIterable<SseEvent>,
): AsyncIterable<StreamPart> {
  switch (provider) {
    case "openai": {
      let lastFinishReason: string | null = null;
      for await (const event of events) {
        const trimmedData = event.data.trim();
        if (trimmedData === "[DONE]") {
          yield { type: "done", reason: lastFinishReason };
          return;
        }

        const parsed = parseJsonSafe(event.data) as {
          choices?: Array<{
            delta?: { content?: string | null };
            finish_reason?: string | null;
          }>;
        };

        const choice = parsed?.choices?.[0];
        if (choice) {
          if (typeof choice.finish_reason === "string") {
            lastFinishReason = choice.finish_reason;
          }
          const content = choice.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            yield { type: "text", text: content };
          }
        }
      }
      // Stream ended without [DONE]
      yield { type: "done", reason: lastFinishReason };
      break;
    }

    case "anthropic": {
      let rememberedStopReason: string | null = null;
      for await (const event of events) {
        if (event.event === "error") {
          const parsed = parseJsonSafe(event.data) as {
            error?: { type?: string; message?: string };
          };
          const errType = parsed?.error?.type ?? "error";
          const errMsg = parsed?.error?.message ?? "Unknown error";
          yield { type: "error", message: `${errType}: ${errMsg}` };
          return;
        }

        if (event.event === "content_block_delta") {
          const parsed = parseJsonSafe(event.data) as {
            delta?: { type?: string; text?: string };
          };
          if (parsed?.delta?.type === "text_delta" && typeof parsed.delta.text === "string") {
            yield { type: "text", text: parsed.delta.text };
          }
        } else if (event.event === "message_delta") {
          const parsed = parseJsonSafe(event.data) as {
            delta?: { stop_reason?: string | null };
          };
          if (typeof parsed?.delta?.stop_reason === "string") {
            rememberedStopReason = parsed.delta.stop_reason;
          }
        } else if (event.event === "message_stop") {
          yield { type: "done", reason: rememberedStopReason };
          return;
        }
        // ping and other events ignored
      }
      // Stream ended without message_stop
      yield { type: "done", reason: rememberedStopReason };
      break;
    }

    case "gemini": {
      let lastFinishReason: string | null = null;
      for await (const event of events) {
        const parsed = parseJsonSafe(event.data) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
            finishReason?: string;
          }>;
        };

        const candidate = parsed?.candidates?.[0];
        if (candidate) {
          if (typeof candidate.finishReason === "string") {
            lastFinishReason = candidate.finishReason;
          }
          const parts = candidate.content?.parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (typeof part.text === "string" && part.text.length > 0) {
                yield { type: "text", text: part.text };
              }
            }
          }
        }
      }
      yield { type: "done", reason: lastFinishReason };
      break;
    }

    default: {
      const exhaustiveCheck: never = provider;
      throw new SseError(`Unknown provider: ${String(exhaustiveCheck)}`, "INVALID_OPTIONS");
    }
  }
}

/**
 * Configuration options for {@link reconnecting}.
 */
export interface ReconnectOptions {
  /** Maximum consecutive retries before failing (default: 3). */
  maxRetries?: number;
  /** Injected sleep delay function. */
  sleep: (ms: number) => Promise<void>;
  /** Default retry wait in milliseconds (default: 1000). */
  defaultRetryMs?: number;
  /** Parser options passed down to the underlying {@link SseParser}. */
  parserOptions?: SseParserOptions;
}

/**
 * Consumes a resilient connection that automatically retries and passes the Last-Event-ID.
 */
export async function* reconnecting(
  open: (lastEventId: string | undefined) => Promise<AsyncIterable<Uint8Array | string>>,
  opts: ReconnectOptions,
): AsyncIterable<SseEvent> {
  const maxRetries = opts.maxRetries ?? 3;
  const defaultRetryMs = opts.defaultRetryMs ?? 1000;

  if (opts.maxRetries !== undefined) {
    validatePositiveInteger(opts.maxRetries, "maxRetries");
  }
  if (opts.defaultRetryMs !== undefined) {
    validatePositiveInteger(opts.defaultRetryMs, "defaultRetryMs");
  }
  if (typeof opts.sleep !== "function") {
    throw new SseError("Option 'sleep' must be a function.", "INVALID_OPTIONS");
  }

  let lastEventId: string | undefined;
  let currentRetryMs = defaultRetryMs;
  let receivedRetryMs: number | undefined;
  // Each connection gets a fresh parser, but the last event id and retry persist across reconnects
  // (as in EventSource), so events from a later connection carry them over.
  const track = (raw: SseEvent): SseEvent => {
    const ev: SseEvent = { ...raw };
    if (ev.id.length > 0) {
      lastEventId = ev.id;
    } else if (lastEventId !== undefined) {
      ev.id = lastEventId;
    }
    if (ev.retry !== undefined) {
      receivedRetryMs = ev.retry;
      currentRetryMs = ev.retry;
    } else if (receivedRetryMs !== undefined) {
      ev.retry = receivedRetryMs;
    }
    return ev;
  };
  let consecutiveFailures = 0;

  while (true) {
    let stream: AsyncIterable<Uint8Array | string>;
    try {
      stream = await open(lastEventId);
    } catch (openErr) {
      consecutiveFailures++;
      if (consecutiveFailures >= maxRetries) {
        throw new SseError(
          `Reconnection failed after ${consecutiveFailures} consecutive attempts.`,
          "RETRIES_EXHAUSTED",
        );
      }
      await opts.sleep(currentRetryMs);
      continue;
    }

    const parser = new SseParser(opts.parserOptions);
    let streamCompleted = false;

    try {
      for await (const chunk of stream) {
        const events = parser.push(chunk);
        for (const ev of events) {
          consecutiveFailures = 0;
          yield track(ev);
        }
      }

      const endEvents = parser.end();
      for (const ev of endEvents) {
        consecutiveFailures = 0;
        yield track(ev);
      }

      streamCompleted = true;
    } catch (streamErr) {
      consecutiveFailures++;
      if (consecutiveFailures >= maxRetries) {
        throw new SseError(
          `Stream error after ${consecutiveFailures} consecutive failures: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`,
          "RETRIES_EXHAUSTED",
        );
      }
      await opts.sleep(currentRetryMs);
      continue;
    }

    if (streamCompleted) {
      return;
    }
  }
}
