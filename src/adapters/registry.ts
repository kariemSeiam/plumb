// PLUMB — Adapter Registry
// detectAdapter: returns the first adapter whose binary matches the CLI command.
// EchoAdapter for 'cat'. GenericAdapter for everything else.

import { EchoAdapter } from './echo.ts';
import { PiAdapter } from './pi.ts';
import { ClaudeAdapter } from './claude.ts';
import { CursorAdapter } from './cursor.ts';
import { OpenCodeAdapter } from './opencode.ts';
import { WolfyAdapter } from './wolfy.ts';
import { VenomAdapter } from './venom.ts';
import { GenericAdapter } from './generic.ts';
import type { AgentAdapter } from '../types.ts';

// Priority order: first match wins. GenericAdapter always last.
const KNOWN_ADAPTERS: AgentAdapter[] = [
  new EchoAdapter(),
  new PiAdapter(),
  new WolfyAdapter(),
  new ClaudeAdapter(),
  new CursorAdapter(),
  new OpenCodeAdapter(),
  new VenomAdapter(),
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Detect all registered adapters. Returns {name, found, version, path, error} for each. */
export async function detectAll(): Promise<Array<{ name: string; found: boolean; version?: string; path?: string; error?: string }>> {
  const results: Array<{ name: string; found: boolean; version?: string; path?: string; error?: string }> = [];
  for (const adapter of KNOWN_ADAPTERS) {
    try {
      const result = await adapter.detect();
      if (result) {
        results.push({ name: adapter.displayName, found: true, version: result.version, path: result.path });
      } else {
        results.push({ name: adapter.displayName, found: false, error: 'Not found' });
      }
    } catch (err) {
      results.push({ name: adapter.displayName, found: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export function detectAdapter(cli: string): AgentAdapter {
  for (const adapter of KNOWN_ADAPTERS) {
    if (!adapter.binary) continue;
    // Match binary name at word boundaries — /usr/bin/cat matches 'cat', some-cat-wrapper does not.
    const re = new RegExp('(?:^|[/\\s])' + escapeRegex(adapter.binary) + '(?:$|[/\\s])');
    if (re.test(cli)) return adapter;
    // Also match exact
    if (cli.trim() === adapter.binary) return adapter;
  }
  return new GenericAdapter(cli);
}
