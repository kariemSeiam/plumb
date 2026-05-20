// PLUMB — Shared binary detection utility
// All adapters use the same `which` + `--version` pattern. DRY it.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DetectionResult } from '../types.ts';

const execFileAsync = promisify(execFile);

export async function detectBinary(
  name: string,
  tier: 1 | 2 | 3,
  protocol: string,
  versionArgs: string[] = ['--version'],
): Promise<DetectionResult | null> {
  try {
    const { stdout } = await execFileAsync('which', [name], { timeout: 5000 });
    let version = 'unknown';
    try {
      const { stdout: vOut } = await execFileAsync(name, versionArgs, { timeout: 5000 });
      version = vOut.trim().split('\n')[0] ?? 'unknown';
    } catch { /* version check failed */ }
    return { binary: name, version, path: stdout.trim(), tier, protocol };
  } catch {
    return null;
  }
}
