// PLUMB — Adapter Registry
// detectAdapter: returns the first adapter whose binary matches the CLI command.
// EchoAdapter for 'cat'. GenericAdapter for everything else.
// Add real adapters here as they are built (Pi, Claude, Cursor...).

import { EchoAdapter } from './echo.ts';
import { PiAdapter } from './pi.ts';
import { ClaudeAdapter } from './claude.ts';
import { OpenCodeAdapter } from './opencode.ts';
import { GenericAdapter } from './generic.ts';
import type { AgentAdapter } from '../types.ts';

// Priority order: first match wins. GenericAdapter always last.
const KNOWN_ADAPTERS: AgentAdapter[] = [
  new EchoAdapter(),
  new PiAdapter(),
  new ClaudeAdapter(),
  new OpenCodeAdapter(),
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
