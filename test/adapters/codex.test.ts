// PLUMB — Codex adapter: parse, argv, and a fake `codex` behind a real server.

import { describe, it, expect, afterEach } from 'bun:test';
import { CodexAdapter } from '../../src/adapters/codex.ts';
import { detectAdapter } from '../../src/adapters/registry.ts';
import { startFake, send, rpc, openStream, isAlive, waitFor, existsSync, readFileSync, join, type Fake } from './harness.ts';

const task = { id: 't', message: 'fix the bug' };
const line = (o: unknown) => JSON.stringify(o);

describe('CodexAdapter', () => {
  const a = new CodexAdapter();

  it('is registered for codex commands', () => {
    expect(detectAdapter('codex').id).toBe('codex');
    expect(detectAdapter('/usr/local/bin/codex').id).toBe('codex');
  });

  it('runs `exec --json` and reads the prompt from stdin', () => {
    const args = a.buildArgs(task, { cli: 'codex', port: 0 });
    expect(args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(args[args.length - 1]).toBe('-');
    expect(a.formatInput(task)).toBe('fix the bug\n');
  });

  it('agent_message → text', () => {
    expect(a.parseLine(line({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } })))
      .toEqual([{ type: 'text-delta', text: 'Done.\n' }]);
  });

  it('reasoning → thinking', () => {
    expect(a.parseLine(line({ type: 'item.completed', item: { type: 'reasoning', text: 'hmm' } })))
      .toEqual([{ type: 'thinking', text: 'hmm' }]);
  });

  it('command_execution → tool call + result, non-zero exit is an error', () => {
    const ev = a.parseLine(line({
      type: 'item.completed',
      item: { type: 'command_execution', command: 'ls', aggregated_output: 'a\n', exit_code: 2 },
    }));
    expect(ev[0]).toEqual({ type: 'tool-call', tool: 'bash', input: { command: 'ls' } });
    expect(ev[1]).toEqual({ type: 'tool-result', tool: 'bash', output: 'a', isError: true });
  });

  it('turn.completed → completed; turn.failed and error → error', () => {
    expect(a.parseLine(line({ type: 'turn.completed', usage: {} }))).toEqual([{ type: 'status', state: 'completed' }]);
    expect(a.parseLine(line({ type: 'turn.failed', error: { message: 'boom' } }))).toEqual([{ type: 'error', message: 'boom' }]);
    expect(a.parseLine(line({ type: 'error', message: 'bad' }))).toEqual([{ type: 'error', message: 'bad' }]);
  });

  it('ignores lifecycle noise and blanks; non-JSON passes through as text', () => {
    expect(a.parseLine(line({ type: 'thread.started', thread_id: 'x' }))).toEqual([]);
    expect(a.parseLine(line({ type: 'item.started', item: { type: 'command_execution' } }))).toEqual([]);
    expect(a.parseLine('')).toEqual([]);
    expect(a.parseLine('plain')).toEqual([{ type: 'text-delta', text: 'plain\n' }]);
  });
});

describe('codex end to end (fake binary)', () => {
  let fake: Fake | undefined;
  afterEach(() => { fake?.stop(); fake = undefined; });

  it('spawns, feeds the prompt on stdin, streams the answer', async () => {
    const script = [
      'prompt=$(cat)',
      `echo '{"type":"thread.started","thread_id":"t1"}'`,
      `echo "{\\"type\\":\\"item.completed\\",\\"item\\":{\\"type\\":\\"agent_message\\",\\"text\\":\\"args=$* prompt=$prompt\\"}}"`,
      `echo '{"type":"turn.completed","usage":{}}'`,
    ].join('\n');
    fake = await startFake('codex', script, 9220);
    const out = await send(fake.url, 'add tests');
    expect(out).toContain('args=exec --json');
    expect(out).toContain('prompt=add tests');
  });

  it('cancel reaps the child process', async () => {
    fake = await startFake('codex', 'echo $$ > "${0%/*}/pid"; cat >/dev/null; echo \'{"type":"item.completed","item":{"type":"agent_message","text":"working"}}\'; exec sleep 60', 9221);
    const { reader, taskId } = await openStream(fake.url, 'long job');
    const pidFile = join(fake.dir, 'pid');
    await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(isAlive(pid)).toBe(true);
    expect(taskId).toBeDefined();

    await rpc(fake.url, 'tasks/cancel', { id: taskId });
    await waitFor(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
    await reader.cancel();
  });
});
