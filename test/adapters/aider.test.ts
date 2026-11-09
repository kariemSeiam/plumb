// PLUMB — Aider adapter: parse, argv, and a fake `aider` behind a real server.

import { describe, it, expect, afterEach } from 'bun:test';
import { AiderAdapter } from '../../src/adapters/aider.ts';
import { detectAdapter } from '../../src/adapters/registry.ts';
import { startFake, send, rpc, openStream, isAlive, waitFor, existsSync, readFileSync, join, type Fake } from './harness.ts';

const task = { id: 't', message: 'fix the bug' };

describe('AiderAdapter', () => {
  const a = new AiderAdapter();

  it('is registered for aider commands', () => {
    expect(detectAdapter('aider').id).toBe('aider');
    expect(detectAdapter('/usr/local/bin/aider --model x').id).toBe('aider');
  });

  it('passes the prompt via --message with --yes-always, nothing on stdin', () => {
    const args = a.buildArgs(task, { cli: 'aider', port: 0 });
    expect(args.slice(0, 2)).toEqual(['--message', 'fix the bug']);
    expect(args).toContain('--yes-always');
    expect(a.formatInput(task)).toBe('');
  });

  it('streams plain lines as text, drops blanks', () => {
    expect(a.parseLine('Applied edit to x.ts')).toEqual([{ type: 'text-delta', text: 'Applied edit to x.ts\n' }]);
    expect(a.parseLine('   ')).toEqual([]);
  });
});

describe('aider end to end (fake binary)', () => {
  let fake: Fake | undefined;
  afterEach(() => { fake?.stop(); fake = undefined; });

  it('spawns, receives --message, streams output', async () => {
    fake = await startFake('aider', 'echo "args: $*"; echo "edited foo.ts"', 9210);
    const out = await send(fake.url, 'add tests');
    expect(out).toContain('args: --message add tests --yes-always');
    expect(out).toContain('edited foo.ts');
  });

  it('cancel reaps the child process', async () => {
    fake = await startFake('aider', 'echo $$ > "${0%/*}/pid"; echo started; exec sleep 60', 9211);
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
