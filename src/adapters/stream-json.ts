// PLUMB — Stream JSON Parser Utility
// Shared parseLine logic for stream-json adapters (Cursor, Claude, Venom).
// Reduces duplication: every oneshot JSON-line agent has the same skeleton.

import type { AdapterEvent } from '../types.ts';

/** Minimal base for any stream-json line. `message` is intentionally `unknown`
 *  because different agents use it differently (string for some, object for others). */
interface StreamJsonBaseEvent {
  type: string;
  subtype?: string;
  timestamp_ms?: number;
  is_error?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** Event with a structured .message.content array (Cursor, Venom). */
export interface ContentBlockEvent {
  type: string;
  subtype?: string;
  timestamp_ms?: number;
  is_error?: boolean;
  error?: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  [key: string]: unknown;
}

/** Parsed result from tryParseStreamLine. */
export interface ParsedLine {
  json: StreamJsonBaseEvent | null;
  raw: string;
}

/**
 * Attempt to parse a stdout line as JSON. Fallback to raw text-delta.
 * Returns { json: null, raw: '' } for empty/whitespace lines (callers skip these).
 */
export function tryParseLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (!trimmed) return { json: null, raw: '' };
  try {
    return { json: JSON.parse(trimmed) as StreamJsonBaseEvent, raw: line };
  } catch {
    return { json: null, raw: line };
  }
}

/**
 * Extract text from a message.content array (Cursor/Venom format).
 * Filters for { type: "text", text: string } blocks, joins with newline.
 */
export function extractContentText(event: ContentBlockEvent): string | null {
  const content = event.message?.content;
  if (!content || !Array.isArray(content)) return null;
  const texts = content
    .filter((c): c is { type: string; text: string } =>
      c.type === 'text' && typeof c.text === 'string'
    )
    .map(c => c.text);
  return texts.length > 0 ? texts.join('\n') : null;
}

/**
 * Check if a stream-json event is a consolidated (non-streaming) assistant event
 * that should be skipped when streamPartial is enabled.
 * Consolidated events lack timestamp_ms; streaming deltas have it.
 */
export function isConsolidatedAssistant(event: ContentBlockEvent, streamPartial: boolean): boolean {
  return streamPartial && !event.timestamp_ms;
}

/** Build a text-delta event. */
export function textDelta(text: string): AdapterEvent {
  return { type: 'text-delta', text };
}

/** Build a status event. */
export function statusEvent(state: 'working' | 'completed' | 'failed'): AdapterEvent {
  return { type: 'status', state };
}

/** Build an error event. */
export function errorEvent(message: string, code?: string): AdapterEvent {
  return { type: 'error', message, ...(code ? { code } : {}) };
}