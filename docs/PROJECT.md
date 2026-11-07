# Project record: llm-sse-parser

## Objective

Provide a robust, spec-compliant SSE parser for LLM streams that prevents common pitfalls in hand-rolled implementations.

## Scope

- WHATWG-compliant event stream parsing.
- Byte-safe streaming UTF-8 decoding.
- Typed provider delta normalization for OpenAI, Anthropic, and Gemini.
- Resilient reconnection with state persistence.

## Out of Scope

- HTTP request management (caller provides the byte stream).
- Browser-specific `EventSource` API implementation.
- Complex LLM tool-call delta processing.

## Effort metrics

| Metric | Value |
|---|---|
| Tokens (input / output) | 6425933 / 22280 |
| Hours (human) | pending measurement |
| Cost (USD) | 1.0162 |

## Factory run u103 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | gemini-3.8-flash | yes | 4815 | 11953 | 0 | 0 | 0.0242 |
| fix-1 | gemini-3.8-flash | no | 83476 | 865 | 0 | 641827 | 0.1140 |
| fix-2 | gemini-3.8-flash | no | 82253 | 842 | 0 | 675410 | 0.1155 |
| fix-3 | gemini-3.8-flash | no | 87897 | 792 | 0 | 671822 | 0.1193 |
| fix-4 | gemini-3.8-flash | no | 82241 | 1228 | 0 | 596890 | 0.1111 |
| fix-1 | gemini-3.8-flash | no | 89472 | 1464 | 0 | 705888 | 0.1255 |
| fix-2 | gemini-3.8-flash | no | 97502 | 951 | 0 | 1064625 | 0.1565 |
| fix-3 | gemini-3.8-flash | no | 86298 | 926 | 0 | 616011 | 0.1144 |
| fix-4 | gemini-3.8-flash | no | 82752 | 893 | 0 | 592631 | 0.1099 |
| audit | gemini-3.1-flash-lite | no | 65773 | 519 | 0 | 83140 | 0.0193 |
| docs | gemini-3.1-flash-lite | no | 15210 | 1847 | 0 | 0 | 0.0066 |

Total: $1.0162. Prices: Anthropic list prices.
