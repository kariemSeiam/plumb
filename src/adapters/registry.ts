// PLUMB — Adapter Registry
// detectAdapter: returns the first adapter whose binary matches the CLI command.
// Loads built-in adapters + any installed plugins from .plumb/plugins.json.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EchoAdapter } from './echo.ts';
import { PiAdapter } from './pi.ts';
import { ClaudeAdapter } from './claude.ts';
import { CursorAdapter } from './cursor.ts';
import { OpenCodeAdapter } from './opencode.ts';
import { WolfyAdapter } from './wolfy.ts';
import { VenomAdapter } from './venom.ts';
import { GenericAdapter } from './generic.ts';
import type { AgentAdapter } from '../types.ts';

const BUILT_IN_ADAPTERS: AgentAdapter[] = [
  new EchoAdapter(),
  new PiAdapter(),
  new WolfyAdapter(),
  new ClaudeAdapter(),
  new CursorAdapter(),
  new OpenCodeAdapter(),
  new VenomAdapter(),
];

let _pluginCache: AgentAdapter[] | null = null;

async function loadPlugins(): Promise<AgentAdapter[]> {
  if (_pluginCache !== null) return _pluginCache;
  const pluginsPath = join(process.cwd(), '.plumb', 'plugins.json');
  if (!existsSync(pluginsPath)) {
    _pluginCache = [];
    return _pluginCache;
  }
  let pkgs: string[] = [];
  try {
    pkgs = JSON.parse(readFileSync(pluginsPath, 'utf8')) as string[];
  } catch {
    _pluginCache = [];
    return _pluginCache;
  }
  const adapters: AgentAdapter[] = [];
  for (const pkg of pkgs) {
    try {
      const mod = await import(pkg) as { default?: AgentAdapter };
      if (mod.default && typeof mod.default === 'object') {
        adapters.push(mod.default);
      }
    } catch { /* skip bad plugins */ }
  }
  _pluginCache = adapters;
  return _pluginCache;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchAdapter(adapters: AgentAdapter[], cli: string): AgentAdapter | null {
  for (const adapter of adapters) {
    if (!adapter.binary) continue;
    const re = new RegExp('(?:^|[/\\s])' + escapeRegex(adapter.binary) + '(?:$|[/\\s])');
    if (re.test(cli) || cli.trim() === adapter.binary) return adapter;
  }
  return null;
}

/** Detect all registered adapters (built-in + plugins). */
export async function detectAll(): Promise<Array<{ name: string; found: boolean; version?: string; path?: string; error?: string }>> {
  const plugins = await loadPlugins();
  const all = [...BUILT_IN_ADAPTERS, ...plugins];
  const results: Array<{ name: string; found: boolean; version?: string; path?: string; error?: string }> = [];
  for (const adapter of all) {
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

export async function detectAdapter(cli: string): Promise<AgentAdapter> {
  const plugins = await loadPlugins();
  // Plugin adapters take priority over built-ins so community adapters can override
  const match = matchAdapter(plugins, cli) ?? matchAdapter(BUILT_IN_ADAPTERS, cli);
  return match ?? new GenericAdapter(cli);
}

/** Synchronous version for contexts where async isn't possible (legacy callers). */
export function detectAdapterSync(cli: string): AgentAdapter {
  return matchAdapter(BUILT_IN_ADAPTERS, cli) ?? new GenericAdapter(cli);
}
