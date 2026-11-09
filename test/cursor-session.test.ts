import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CursorAdapter, parseModelList } from '../src/adapters/cursor.ts';
import type { AgentTask, PlumbConfig } from '../src/types.ts';

const config: PlumbConfig = { cli: 'cursor-agent', port: 0 };
const task = (contextId?: string, metadata?: Record<string, unknown>): AgentTask => ({
  id: 't1', message: 'hi', context: { contextId, metadata },
});
const sys = (id: string) => JSON.stringify({ type: 'system', session_id: id, cwd: '/w', model: 'm' });
const done = JSON.stringify({ type: 'result', subtype: 'success' });

/** Run one fake turn: build args, feed the system + result events. */
function turn(a: CursorAdapter, t: AgentTask, sid: string): string[] {
  const args = a.buildArgs(t, config);
  a.formatInput(t);
  a.setUserMessage(t.message);
  a.parseLine(sys(sid));
  a.parseLine(done);
  return args;
}

describe('cursor sessions per contextId', () => {
  it('first turn is fresh, second turn resumes the same session', () => {
    const a = new CursorAdapter();
    const first = turn(a, task('ctx-a'), 'sess-1');
    expect(first).not.toContain('--resume');
    expect(first).not.toContain('--continue');
    expect(a.sessionForContext('ctx-a')).toBe('sess-1');
    const second = a.buildArgs(task('ctx-a'), config);
    expect(second.slice(second.indexOf('--resume'), second.indexOf('--resume') + 2)).toEqual(['--resume', 'sess-1']);
  });

  it('a different contextId does not inherit another context\'s session', () => {
    const a = new CursorAdapter();
    turn(a, task('ctx-a'), 'sess-1');
    const b = a.buildArgs(task('ctx-b'), config);
    expect(b).not.toContain('--resume');
    expect(b).not.toContain('--continue');
    a.parseLine(sys('sess-2'));
    expect(a.sessionForContext('ctx-b')).toBe('sess-2');
    expect(a.sessionForContext('ctx-a')).toBe('sess-1');
  });

  it('newChat starts a fresh session for the same context', () => {
    const a = new CursorAdapter();
    turn(a, task('ctx-a'), 'sess-1');
    expect(a.buildArgs(task('ctx-a', { newChat: true }), config)).not.toContain('--resume');
  });

  it('starts over once maxSessionTurns is reached', () => {
    const a = new CursorAdapter({ maxSessionTurns: 2 });
    turn(a, task('c'), 's');
    expect(a.buildArgs(task('c'), config)).toContain('--resume');
    a.parseLine(sys('s')); // second turn registered
    expect(a.buildArgs(task('c'), config)).not.toContain('--resume');
  });

  it('explicit resumeSession wins over the context map', () => {
    const a = new CursorAdapter();
    turn(a, task('c'), 's1');
    const args = a.buildArgs(task('c', { resumeSession: 'other' }), config);
    expect(args[args.indexOf('--resume') + 1]).toBe('other');
  });

  it('without a contextId keeps the legacy --continue behaviour', () => {
    const a = new CursorAdapter();
    turn(a, task(), 's1');
    expect(a.buildArgs(task(), config)).toContain('--continue');
  });
});

describe('cursor worktree and plan mode', () => {
  it('worktree option names the worktree after the contextId, stable across turns', () => {
    const a = new CursorAdapter({ worktree: true });
    const args = a.buildArgs(task('ctx/a b'), config);
    expect(args[args.indexOf('--worktree') + 1]).toBe('plumb-ctx-a-b');
    const again = a.buildArgs(task('ctx/a b'), config);
    expect(again[again.indexOf('--worktree') + 1]).toBe('plumb-ctx-a-b');
  });

  it('metadata worktree name overrides; off by default', () => {
    const a = new CursorAdapter();
    expect(a.buildArgs(task('c'), config)).not.toContain('--worktree');
    const args = a.buildArgs(task('c', { worktree: 'feat-x' }), config);
    expect(args[args.indexOf('--worktree') + 1]).toBe('feat-x');
  });

  it('plan mode via option or metadata, off by default', () => {
    expect(new CursorAdapter().buildArgs(task('c'), config)).not.toContain('--plan');
    expect(new CursorAdapter({ planMode: true }).buildArgs(task('c'), config)).toContain('--plan');
    expect(new CursorAdapter().buildArgs(task('c', { planMode: true }), config)).toContain('--plan');
  });
});

describe('cursor model listing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plumb-cursor-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('parses id - name lines, strips ANSI and markers', () => {
    const out = '\x1b[1mAvailable models\x1b[0m\n\nauto - Auto\ncomposer-2.5-fast - Composer 2.5 Fast (current, default)\ngpt-5.3-codex - GPT-5.3 Codex\n';
    expect(parseModelList(out)).toEqual([
      { id: 'auto', name: 'Auto' },
      { id: 'composer-2.5-fast', name: 'Composer 2.5 Fast' },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
    ]);
  });

  it('listModels runs the binary with --list-models (fake binary)', async () => {
    const bin = join(dir, 'fake-cursor-agent');
    writeFileSync(bin, '#!/bin/sh\n[ "$1" = "--list-models" ] || exit 2\necho "m1 - Model One"\necho "m2 - Model Two"\n');
    chmodSync(bin, 0o755);
    expect(await new CursorAdapter().listModels(bin)).toEqual([
      { id: 'm1', name: 'Model One' },
      { id: 'm2', name: 'Model Two' },
    ]);
  });

  it('listModels rejects when the binary fails', async () => {
    const bin = join(dir, 'bad-cursor-agent');
    writeFileSync(bin, '#!/bin/sh\nexit 1\n');
    chmodSync(bin, 0o755);
    await expect(new CursorAdapter().listModels(bin)).rejects.toBeDefined();
  });
});
