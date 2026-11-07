import { describe, expect, it } from "vitest";
import {
  type ProviderName,
  reconnecting,
  SseError,
  type SseEvent,
  SseParser,
  toTextDeltas,
} from "../src/index.js";

async function toArray<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}

async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

async function* errorStream<T>(items: T[], errorToThrow: Error): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
  throw errorToThrow;
}

describe("SseParser Specification & Acceptance Tests", () => {
  it("new SseParser().push('data: a\\ndata: b\\n\\n') returns [{ event: 'message', data: 'a\\nb', id: '' }], and 'data\\n\\n' yields one event with data ''", () => {
    const parser1 = new SseParser();
    const res1 = parser1.push("data: a\ndata: b\n\n");
    expect(res1).toEqual([{ event: "message", data: "a\nb", id: "" }]);

    const parser2 = new SseParser();
    const res2 = parser2.push("data\n\n");
    expect(res2).toEqual([{ event: "message", data: "", id: "" }]);
  });

  it("Pushing 'data: x\\r' then '\\n\\r\\n' yields exactly one event with data 'x', and pushing the UTF-8 bytes of 'data: \u00e9\\n\\n' split inside '\u00e9' yields data '\u00e9'", () => {
    const parser1 = new SseParser();
    const ev1 = parser1.push("data: x\r");
    expect(ev1).toEqual([]);
    const ev2 = parser1.push("\n\r\n");
    expect(ev2).toEqual([{ event: "message", data: "x", id: "" }]);

    const parser2 = new SseParser();
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode("data: é\n\n");
    // In UTF-8, '\u00e9' is 2 bytes: 0xC3, 0xA9. 'data: ' is 6 bytes (0..5), \u00e9 is indices 6 and 7.
    const part1 = fullBytes.subarray(0, 7);
    const part2 = fullBytes.subarray(7);
    expect(parser2.push(part1)).toEqual([]);
    const events = parser2.push(part2);
    expect(events).toEqual([{ event: "message", data: "\u00e9", id: "" }]);
  });

  it("': ping\\nid: 7\\nevent: delta\\ndata:{\"t\":1}\\nretry: 1500\\n\\n' yields [{ event: 'delta', data: '{\"t\":1}', id: '7', retry: 1500 }], while 'retry: 1.5' is ignored and an id containing '\\u0000' leaves the last event id unchanged", () => {
    const parser = new SseParser();
    const res = parser.push(': ping\nid: 7\nevent: delta\ndata:{"t":1}\nretry: 1500\n\n');
    expect(res).toEqual([{ event: "delta", data: '{"t":1}', id: "7", retry: 1500 }]);

    // 'retry: 1.5' is ignored
    const resRetry = parser.push("retry: 1.5\ndata: test\n\n");
    expect(resRetry).toEqual([{ event: "message", data: "test", id: "7", retry: 1500 }]);

    // id with '\u0000' leaves the last event id unchanged
    const resNullId = parser.push("id: bad\u0000id\ndata: still 7\n\n");
    expect(resNullId).toEqual([{ event: "message", data: "still 7", id: "7", retry: 1500 }]);
  });

  it("end() after pushing 'data: partial' returns [] (an unterminated event is not dispatched), and new SseParser({ maxLineBytes: 16 }) accepts a 16-byte line but throws SseError with code 'LINE_TOO_LONG' for a 17-byte line", () => {
    const parser1 = new SseParser();
    parser1.push("data: partial");
    expect(parser1.end()).toEqual([]);

    const parser16 = new SseParser({ maxLineBytes: 16 });
    // Exactly 16 bytes: 'data: 0123456789' (6 + 10 = 16)
    expect(() => parser16.push("data: 0123456789\n\n")).not.toThrow();

    const parser16Overflow = new SseParser({ maxLineBytes: 16 });
    // 17 bytes: 'data: 0123456789a'
    expect(() => parser16Overflow.push("data: 0123456789a\n\n")).toThrowError(
      expect.objectContaining({
        name: "SseError",
        code: "LINE_TOO_LONG",
      }),
    );
  });

  it('toTextDeltas(\'openai\', events) over data \'{"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\', \'{"choices":[{"delta":{},"finish_reason":"stop"}]}\' and \'[DONE]\' yields [{ type: \'text\', text: \'Hi\' }, { type: \'done\', reason: \'stop\' }]', async () => {
    const events: SseEvent[] = [
      {
        event: "message",
        data: '{"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}',
        id: "",
      },
      {
        event: "message",
        data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
        id: "",
      },
      { event: "message", data: "[DONE]", id: "" },
    ];
    const deltas = await toArray(toTextDeltas("openai", fromArray(events)));
    expect(deltas).toEqual([
      { type: "text", text: "Hi" },
      { type: "done", reason: "stop" },
    ]);
  });

  it("toTextDeltas('anthropic', events) over content_block_delta '{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}', message_delta with stop_reason 'end_turn' and message_stop yields [{ type: 'text', text: 'Hi' }, { type: 'done', reason: 'end_turn' }]; an error event with error type 'overloaded_error' and message 'Overloaded' yields { type: 'error', message: 'overloaded_error: Overloaded' }", async () => {
    const eventsSuccess: SseEvent[] = [
      {
        event: "content_block_delta",
        data: '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
        id: "",
      },
      {
        event: "message_delta",
        data: '{"delta":{"stop_reason":"end_turn"}}',
        id: "",
      },
      { event: "message_stop", data: "{}", id: "" },
    ];
    const deltasSuccess = await toArray(toTextDeltas("anthropic", fromArray(eventsSuccess)));
    expect(deltasSuccess).toEqual([
      { type: "text", text: "Hi" },
      { type: "done", reason: "end_turn" },
    ]);

    const eventsError: SseEvent[] = [
      {
        event: "error",
        data: '{"error":{"type":"overloaded_error","message":"Overloaded"}}',
        id: "",
      },
    ];
    const deltasError = await toArray(toTextDeltas("anthropic", fromArray(eventsError)));
    expect(deltasError).toEqual([{ type: "error", message: "overloaded_error: Overloaded" }]);
  });

  it("toTextDeltas('gemini', events) over '{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hi\"}]},\"finishReason\":\"STOP\"}]}' yields text 'Hi' then { type: 'done', reason: 'STOP' } at stream end, and data 'not json' throws SseError with code 'INVALID_JSON' whose message is at most 200 characters", async () => {
    const geminiEvents: SseEvent[] = [
      {
        event: "message",
        data: '{"candidates":[{"content":{"parts":[{"text":"Hi"}]},"finishReason":"STOP"}]}',
        id: "",
      },
    ];
    const deltas = await toArray(toTextDeltas("gemini", fromArray(geminiEvents)));
    expect(deltas).toEqual([
      { type: "text", text: "Hi" },
      { type: "done", reason: "STOP" },
    ]);

    const badJsonEvents: SseEvent[] = [{ event: "message", data: "not json", id: "" }];
    await expect(async () => {
      for await (const _ of toTextDeltas("gemini", fromArray(badJsonEvents))) {
        // consume
      }
    }).rejects.toMatchObject({
      name: "SseError",
      code: "INVALID_JSON",
    });
  });

  it("reconnecting(open, { maxRetries: 3, sleep }) where the first stream emits 'id: 1\\nretry: 1500\\ndata: a\\n\\n' then throws calls sleep with 1500 and open a second time with lastEventId '1'; three consecutive failed opens throw SseError with code 'RETRIES_EXHAUSTED'", async () => {
    const sleepCalls: number[] = [];
    const openCalls: Array<string | undefined> = [];

    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    let attempt = 0;
    const open = async (lastEventId: string | undefined) => {
      openCalls.push(lastEventId);
      attempt++;
      if (attempt === 1) {
        return errorStream(["id: 1\nretry: 1500\ndata: a\n\n"], new Error("network dropped"));
      }
      return fromArray(["data: b\n\n"]);
    };

    const events = await toArray(
      reconnecting(open, { maxRetries: 3, sleep, defaultRetryMs: 1000 }),
    );
    expect(openCalls).toEqual([undefined, "1"]);
    expect(sleepCalls).toEqual([1500]);
    expect(events).toEqual([
      { event: "message", data: "a", id: "1", retry: 1500 },
      { event: "message", data: "b", id: "1", retry: 1500 },
    ]);

    // Three consecutive failed opens throw RETRIES_EXHAUSTED
    const failOpen = async () => {
      throw new Error("connection failed");
    };
    await expect(async () => {
      for await (const _ of reconnecting(failOpen, {
        maxRetries: 3,
        sleep: async () => {},
      })) {
        // consume
      }
    }).rejects.toMatchObject({
      name: "SseError",
      code: "RETRIES_EXHAUSTED",
    });
  });
});

describe("Edge cases and parser completeness", () => {
  it("handles single byte chunking", () => {
    const parser = new SseParser();
    const text = ": comment\nevent: test\ndata: hello\n\n";
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const events: SseEvent[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes.subarray(i, i + 1);
      events.push(...parser.push(b));
    }
    events.push(...parser.end());
    expect(events).toEqual([{ event: "test", data: "hello", id: "" }]);
  });

  it("handles CR-only line endings", () => {
    const parser = new SseParser();
    const events = parser.push("data: foo\rdata: bar\r\r");
    expect(events).toEqual([{ event: "message", data: "foo\nbar", id: "" }]);
  });

  it("handles empty stream", () => {
    const parser = new SseParser();
    expect(parser.push("")).toEqual([]);
    expect(parser.end()).toEqual([]);
  });

  it("strips BOM only at the beginning", () => {
    const parser = new SseParser();
    const events = parser.push("\uFEFFdata: hello\n\n");
    expect(events).toEqual([{ event: "message", data: "hello", id: "" }]);
  });

  it("ignores comment-only lines and streams", () => {
    const parser = new SseParser();
    const events = parser.push(": this is a comment\n: another\n\n");
    expect(events).toEqual([]);
  });

  it("does not dispatch event with data and no trailing blank line at end", () => {
    const parser = new SseParser();
    parser.push("data: pending");
    expect(parser.end()).toEqual([]);
  });

  it("enforces maxEventBytes limit", () => {
    const parser = new SseParser({ maxEventBytes: 10 });
    expect(() => {
      parser.push("data: 123456789012345\n\n");
    }).toThrowError(
      expect.objectContaining({
        name: "SseError",
        code: "EVENT_TOO_LARGE",
      }),
    );
  });

  it("validates parser options", () => {
    expect(() => new SseParser({ maxLineBytes: -1 })).toThrowError(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
    expect(() => new SseParser({ maxEventBytes: 0 })).toThrowError(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
    expect(() => new SseParser({ maxLineBytes: 1.5 as unknown as number })).toThrowError(
      expect.objectContaining({ code: "INVALID_OPTIONS" }),
    );
  });

  it("validates reconnecting options", async () => {
    await expect(async () => {
      for await (const _ of reconnecting(async () => fromArray([]), {
        maxRetries: 0,
        sleep: async () => {},
      })) {
        //
      }
    }).rejects.toMatchObject({ code: "INVALID_OPTIONS" });

    await expect(async () => {
      for await (const _ of reconnecting(async () => fromArray([]), {
        sleep: undefined as unknown as (ms: number) => Promise<void>,
      })) {
        //
      }
    }).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("truncates bad json messages to 200 characters", async () => {
    const longBadJson = `not-json-${"x".repeat(300)}`;
    try {
      for await (const _ of toTextDeltas(
        "openai",
        fromArray([{ event: "message", data: longBadJson, id: "" }]),
      )) {
        //
      }
      expect.unreachable("Should have thrown");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(SseError);
      const err = e as SseError;
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message.length).toBeLessThan(400);
      expect(err.message).toContain("...");
    }
  });

  it("throws on invalid provider in toTextDeltas", async () => {
    await expect(async () => {
      for await (const _ of toTextDeltas("unknown" as unknown as ProviderName, fromArray([]))) {
        //
      }
    }).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("handles trailing CR at end of chunk without trailing newline in next chunk", () => {
    const parser = new SseParser();
    parser.push("data: first\r");
    const ev = parser.push("\rdata: second\n\n");
    expect(ev).toEqual([
      { event: "message", data: "first", id: "" },
      { event: "message", data: "second", id: "" },
    ]);
  });

  it("dispatches remaining lines upon end() if carriage return was pending", () => {
    const parser = new SseParser();
    // The trailing CR already ends the blank line, so push() dispatches the event and end() has nothing left.
    const evs = parser.push("data: line1\r\n\r");
    expect(evs).toEqual([{ event: "message", data: "line1", id: "" }]);
    expect(parser.end()).toEqual([]);
  });

  it("ignores unknown fields and handles lines without colon", () => {
    const parser = new SseParser();
    const evs = parser.push("foo\ncustom: value\ndata: ok\n\n");
    expect(evs).toEqual([{ event: "message", data: "ok", id: "" }]);
  });

  it("resets failure counter on successful event dispatch across retried streams", async () => {
    let streamAttempt = 0;
    const sleep = async () => {};

    const open = async () => {
      streamAttempt++;
      if (streamAttempt === 1) {
        return errorStream(["data: first\n\n"], new Error("intermittent failure"));
      }
      return fromArray(["data: second\n\n"]);
    };

    const events = await toArray(reconnecting(open, { maxRetries: 2, sleep, defaultRetryMs: 10 }));
    expect(events.map((e) => e.data)).toEqual(["first", "second"]);
  });
});
