# Strict WHATWG Event Stream Interpretation with Unified Provider Delta Streaming

Status: accepted (generated, pending human review)

## Context

LLM providers (OpenAI, Anthropic, Gemini) stream responses over Server-Sent Events (SSE). Custom parsers frequently mismanage UTF-8 boundaries, carriage returns without line feeds, event buffer limits, and provider-specific delta envelopes, leading to broken characters or uncapped memory growth.

## Decision

Implement a zero-dependency SSE parser following WHATWG HTML Living Standard §9.2.6 using a streaming TextDecoder, explicit line-ending detection (CR, LF, CRLF), byte-length guarding on lines and event buffers, and unified text delta transformations across OpenAI, Anthropic, and Gemini.

## Consequences

Developers have a single, hardened, spec-compliant SSE engine that safely handles network fragmentations and resumes interrupted streams using standard Last-Event-ID protocols.
