import { test, expect } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ASSIGNMENT = /(API_KEY|TOKEN|SECRET)\s*=\s*([A-Za-z0-9_.\-]{12,})/g;
// Prefixes must start a token: "task-store" must not match "sk-".
const PREFIXES = /(?<![A-Za-z0-9_])(crsr_|sk-|ghp_)[A-Za-z0-9_\-]{8,}/;

function trackedTextFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString();
  return out.split('\0').filter((f) => f && !f.endsWith('bun.lock'));
}

test('no key-shaped values in tracked files', () => {
  const hits: string[] = [];
  for (const file of trackedTextFiles()) {
    let buf: Buffer;
    try {
      buf = readFileSync(join(ROOT, file));
    } catch {
      continue;
    }
    if (buf.includes(0)) continue; // binary
    buf.toString('utf8').split('\n').forEach((line, i) => {
      const assigned = [...line.matchAll(ASSIGNMENT)].some((m) => !m[2].startsWith('<'));
      if (assigned || PREFIXES.test(line)) hits.push(`${file}:${i + 1}`); // location only, never the value
    });
  }
  expect(hits).toEqual([]);
});
