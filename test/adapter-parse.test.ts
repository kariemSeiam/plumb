// PLUMB — Adapter Unit Tests
// parseLine fixtures for all adapters. No live CLIs needed — pure parse validation.

import { describe, it, expect } from 'bun:test';
import { EchoAdapter } from '../src/adapters/echo.ts';
import { PiAdapter } from '../src/adapters/pi.ts';
import { ClaudeAdapter } from '../src/adapters/claude.ts';
import { CursorAdapter } from '../src/adapters/cursor.ts';
import { OpenCodeAdapter } from '../src/adapters/opencode.ts';
import { VenomAdapter } from '../src/adapters/venom.ts';
import { GenericAdapter } from '../src/adapters/generic.ts';
import { tryParseLine, extractContentText, textDelta, statusEvent, errorEvent } from '../src/adapters/stream-json.ts';

// ── Shared stream-json utility tests ──────────────────────────────────────

describe('stream-json utilities', () => {
  it('tryParseLine: empty line → null json, empty raw', () => {
    const result = tryParseLine('   ');
    expect(result.json).toBeNull();
    expect(result.raw).toBe('');
  });

  it('tryParseLine: non-JSON line → null json, raw preserved', () => {
    const result = tryParseLine('hello world');
    expect(result.json).toBeNull();
    expect(result.raw).toBe('hello world');
  });

  it('tryParseLine: valid JSON → parsed object', () => {
    const result = tryParseLine('{"type":"text","text":"hi"}');
    expect(result.json).not.toBeNull();
    expect(result.json!.type).toBe('text');
  });

  it('extractContentText: extracts text blocks from message.content', () => {
    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'World' },
          { type: 'image', url: 'x' },
        ],
      },
    };
    expect(extractContentText(event)).toBe('Hello \nWorld');
  });

  it('extractContentText: returns null when no text content', () => {
    const event = {
      type: 'assistant',
      message: { content: [{ type: 'image', url: 'x' }] },
    };
    expect(extractContentText(event)).toBeNull();
  });

  it('extractContentText: returns null when no message', () => {
    expect(extractContentText({ type: 'assistant' })).toBeNull();
  });

  it('helper functions produce correct events', () => {
    expect(textDelta('hi')).toEqual({ type: 'text-delta', text: 'hi' });
    expect(statusEvent('completed')).toEqual({ type: 'status', state: 'completed' });
    expect(errorEvent('fail')).toEqual({ type: 'error', message: 'fail' });
    expect(errorEvent('fail', 'CODE')).toEqual({ type: 'error', message: 'fail', code: 'CODE' });
  });
});

// ── Echo Adapter ───────────────────────────────────────────────────────────

describe('EchoAdapter', () => {
  const adapter = new EchoAdapter();

  it('returns text-delta for each non-empty line', () => {
    const events = adapter.parseLine('hello');
    expect(events).toEqual([{ type: 'text-delta', text: 'hello\n' }]);
  });

  it('skips empty lines', () => {
    expect(adapter.parseLine('   ')).toEqual([]);
    expect(adapter.parseLine('')).toEqual([]);
  });

  it('formatInput appends newline', () => {
    expect(adapter.formatInput({ id: '1', message: 'test' })).toBe('test\n');
  });

  it('buildArgs returns empty array', () => {
    expect(adapter.buildArgs({ id: '1', message: 'test' }, { cli: 'cat', port: 3001 })).toEqual([]);
  });
});

// ── Pi Adapter ────────────────────────────────────────────────────────────

describe('PiAdapter', () => {
  const adapter = new PiAdapter();

  it('parses text-delta event', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'text-delta', text: 'hello' }));
    expect(events).toEqual([{ type: 'text-delta', text: 'hello' }]);
  });

  it('parses message_update with text_delta', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'world' },
    }));
    expect(events).toEqual([{ type: 'text-delta', text: 'world' }]);
  });

  it('filters extension_ui_request events', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'extension_ui_request' }))).toEqual([]);
  });

  it('parses agent_end as completed', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'agent_end' }));
    expect(events).toEqual([{ type: 'status', state: 'completed' }]);
  });

  it('parses error event', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'error', error: 'test error' }));
    expect(events).toEqual([{ type: 'error', message: 'test error' }]);
  });

  it('non-JSON line → raw text delta', () => {
    const events = adapter.parseLine('raw text output');
    expect(events).toEqual([{ type: 'text-delta', text: 'raw text output\n' }]);
  });
});

// ── Claude Adapter ────────────────────────────────────────────────────────

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();

  it('parses assistant message with text content', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello Claude' }] },
    }));
    expect(events).toEqual([{ type: 'text-delta', text: 'Hello Claude' }]);
  });

  it('filters system and rate_limit events', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'system' }))).toEqual([]);
    expect(adapter.parseLine(JSON.stringify({ type: 'rate_limit_event' }))).toEqual([]);
  });

  it('parses successful result as completed', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'result' }));
    expect(events).toEqual([{ type: 'status', state: 'completed' }]);
  });

  it('parses error result', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'result', is_error: true, error: 'fail' }));
    expect(events).toEqual([{ type: 'error', message: 'fail' }]);
  });

  it('parses explicit error event', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'error', error: 'bad' }));
    expect(events).toEqual([{ type: 'error', message: 'bad' }]);
  });
});

// ── Cursor Adapter ────────────────────────────────────────────────────────

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter();

  it('parses thinking event as text-delta', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'thinking', text: 'reasoning...' }));
    expect(events).toEqual([{ type: 'text-delta', text: 'reasoning...' }]);
  });

  it('parses assistant content blocks', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'code here' }] },
    }));
    expect(events).toEqual([{ type: 'text-delta', text: 'code here' }]);
  });

  it('filters system and user events', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'system' }))).toEqual([]);
    expect(adapter.parseLine(JSON.stringify({ type: 'user' }))).toEqual([]);
  });

  it('parses tool_call with shellToolCall', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'tool_call',
      tool_call: { shellToolCall: { args: { command: 'ls' } } },
    }));
    expect(events).toEqual([{ type: 'tool-call', tool: 'shell', input: { command: 'ls' } }]);
  });

  it('skips consolidated events when streamPartial=true', () => {
    adapter.streamPartial = true;
    // Consolidated event: no timestamp_ms
    const events = adapter.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'should skip' }] },
    }));
    expect(events).toEqual([]);
    // Streaming delta: has timestamp_ms
    const delta = adapter.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'should emit' }] },
      timestamp_ms: 1234,
    }));
    expect(delta).toEqual([{ type: 'text-delta', text: 'should emit' }]);
    adapter.streamPartial = false; // reset
  });

  it('parses successful result as completed', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'result' }))).toEqual([{ type: 'status', state: 'completed' }]);
  });

  it('parses error result', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'result', subtype: 'error', error: 'crash' }))).toEqual([{ type: 'error', message: 'crash' }]);
  });
});

// ── VENOM Adapter ──────────────────────────────────────────────────────────

describe('VenomAdapter', () => {
  const adapter = new VenomAdapter();

  it('parses assistant content blocks', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'venom output' }] },
      timestamp_ms: 100,
    }));
    expect(events).toEqual([{ type: 'text-delta', text: 'venom output' }]);
  });

  it('skips consolidated events (streamPartial=true by default)', () => {
    // No timestamp_ms = consolidated → skip
    expect(adapter.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'skip' }] },
    }))).toEqual([]);
  });

  it('parses successful result as completed', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'result' }))).toEqual([{ type: 'status', state: 'completed' }]);
  });

  it('parses error event', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'error', error: 'fail' }))).toEqual([{ type: 'error', message: 'fail' }]);
  });

  it('filters system and user events', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'system' }))).toEqual([]);
    expect(adapter.parseLine(JSON.stringify({ type: 'user' }))).toEqual([]);
  });

  it('parses tool_call with shellToolCall', () => {
    const events = adapter.parseLine(JSON.stringify({
      type: 'tool_call',
      tool_call: { shellToolCall: { args: { cmd: 'cargo build' } } },
    }));
    expect(events).toEqual([{ type: 'tool-call', tool: 'shell', input: { cmd: 'cargo build' } }]);
  });
});

// ── OpenCode Adapter ──────────────────────────────────────────────────────

describe('OpenCodeAdapter', () => {
  const adapter = new OpenCodeAdapter();

  it('parses text event', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'text', text: 'hello' }));
    expect(events).toEqual([{ type: 'text-delta', text: 'hello' }]);
  });

  it('parses content event with text', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'content', content: 'output' }));
    expect(events).toEqual([{ type: 'text-delta', text: 'output' }]);
  });

  it('parses step_finish with stop reason as completed', () => {
    const events = adapter.parseLine(JSON.stringify({ type: 'step_finish', part: { reason: 'stop' } }));
    expect(events).toEqual([{ type: 'status', state: 'completed' }]);
  });

  it('parses done event as completed', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'done' }))).toEqual([{ type: 'status', state: 'completed' }]);
  });

  it('parses session.completed as completed', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'session.completed' }))).toEqual([{ type: 'status', state: 'completed' }]);
  });

  it('parses error event', () => {
    expect(adapter.parseLine(JSON.stringify({ type: 'error', error: 'break' }))).toEqual([{ type: 'error', message: 'break' }]);
  });

  it('non-JSON line → raw text delta', () => {
    const events = adapter.parseLine('plain text');
    expect(events).toEqual([{ type: 'text-delta', text: 'plain text\n' }]);
  });

  it('formatInput wraps in JSON prompt', () => {
    const input = adapter.formatInput({ id: '1', message: 'test prompt' });
    expect(JSON.parse(input)).toEqual({ prompt: 'test prompt' });
  });
});

// ── Generic Adapter ────────────────────────────────────────────────────────

describe('GenericAdapter', () => {
  it('returns text-delta for each non-empty line', () => {
    const adapter = new GenericAdapter('cat');
    const events = adapter.parseLine('anything');
    expect(events).toEqual([{ type: 'text-delta', text: 'anything\n' }]);
  });

  it('skips empty lines', () => {
    const adapter = new GenericAdapter('cat');
    expect(adapter.parseLine('  ')).toEqual([]);
  });

  it('formatInput appends newline', () => {
    const adapter = new GenericAdapter('cat');
    expect(adapter.formatInput({ id: '1', message: 'hello' })).toBe('hello\n');
  });
});