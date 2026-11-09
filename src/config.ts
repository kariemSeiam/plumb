// PLUMB — Config (Wave 2)
// Declarative plumb.yaml fleet definition.
// Parsed at boot. Immutable while running.
// Plumb is a bridge, not an orchestrator — config is for validation + codegen.

import { readFileSync, existsSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import type { PlumbConfig } from './types.ts';

export interface FleetAgent {
  /** Stable identifier used in logs, ledger, and future Pulse. */
  id: string;
  /** CLI command string (same as `plumb wrap <cli>`). */
  cli: string;
  /** HTTP port for this agent's A2A server. */
  port: number;
  /** Oneshot (process-per-task) or persistent (single long-running process). */
  mode?: 'oneshot' | 'persistent';
  /** Working directory override. */
  workdir?: string;
  /** Task timeout in seconds (default 300). */
  timeout?: number;
  /** Display name override for agent card. */
  name?: string;
  /** Bearer token for /a2a endpoints. */
  apiKey?: string;
  /** Environment variables (supports ${VAR} substitution). */
  env?: Record<string, string>;
  /** Labels for routing / documentation. */
  labels?: string[];
  /** Enable session store (Cursor only). */
  sessionStore?: boolean;
}

export interface FleetConfig {
  version: string;
  agents: FleetAgent[];
}

export interface FleetValidation {
  valid: boolean;
  agents: Array<{
    id: string;
    cli: string;
    port: number;
    errors: string[];
    warnings: string[];
  }>;
}

const DEFAULT_PATHS = ['plumb.yaml', 'plumb.yml', './config/plumb.yaml'];

/**
 * Resolve plumb.yaml path. Checks default paths if none given.
 * Returns null if no file found (optional config).
 */
export function resolveConfigPath(customPath?: string): string | null {
  if (customPath) {
    return existsSync(customPath) ? customPath : null;
  }
  for (const p of DEFAULT_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Load and parse plumb.yaml.
 * Throws on parse errors. Returns null if no file found.
 */
export function loadFleetConfig(path?: string): FleetConfig | null {
  const resolved = resolveConfigPath(path);
  if (!resolved) return null;

  const raw = readFileSync(resolved, 'utf8');
  const parsed = parseYaml(raw) as Record<string, unknown>;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${resolved}: invalid YAML — expected a document`);
  }

  const version = String(parsed.version ?? '1');
  const agentsRaw = parsed.agents;

  if (!Array.isArray(agentsRaw)) {
    throw new Error(`${resolved}: missing or invalid 'agents' list`);
  }

  const agents: FleetAgent[] = agentsRaw.map((a: Record<string, unknown>, i: number) => {
    if (!a || typeof a !== 'object') {
      throw new Error(`${resolved}: agents[${i}] is not an object`);
    }
    if (!a.id || typeof a.id !== 'string') {
      throw new Error(`${resolved}: agents[${i}] missing required string field 'id'`);
    }
    if (!a.cli || typeof a.cli !== 'string') {
      throw new Error(`${resolved}: agents[${i}] ('${a.id}') missing required string field 'cli'`);
    }
    const port = typeof a.port === 'number' ? a.port : parseInt(String(a.port), 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`${resolved}: agents[${i}] ('${a.id}') invalid 'port' — must be 1-65535`);
    }

    return {
      id: a.id as string,
      cli: a.cli as string,
      port,
      mode: (a.mode as 'oneshot' | 'persistent') ?? undefined,
      workdir: a.workdir as string | undefined,
      timeout: typeof a.timeout === 'number' ? a.timeout : undefined,
      name: a.name as string | undefined,
      apiKey: a.apiKey as string | undefined,
      env: a.env as Record<string, string> | undefined,
      labels: Array.isArray(a.labels) ? (a.labels as string[]) : undefined,
      sessionStore: a.sessionStore as boolean | undefined,
    };
  });

  return { version, agents };
}

/**
 * Validate a fleet config against registered adapters.
 * Checks: binary exists, port unique, no duplicate IDs.
 */
export async function validateFleetConfig(config: FleetConfig): Promise<FleetValidation> {
  const { detectAll } = await import('./adapters/registry.ts');
  const detection = await detectAll();
  const seenPorts = new Set<number>();
  const seenIds = new Set<string>();
  const results: FleetValidation['agents'] = [];

  for (const agent of config.agents) {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (seenIds.has(agent.id)) {
      errors.push(`duplicate agent id '${agent.id}'`);
    }
    seenIds.add(agent.id);

    if (seenPorts.has(agent.port)) {
      errors.push(`port ${agent.port} is already in use by another agent`);
    }
    seenPorts.add(agent.port);

    const match = detection.find(d =>
      agent.cli.includes(d.name.toLowerCase()) ||
      (typeof d.path === 'string' && d.path.includes(agent.cli.split(/[/\s]/).filter(Boolean).pop() ?? agent.cli))
    );

    if (!match || !match.found) {
      warnings.push(`no registered adapter matches '${agent.cli}' — will fall back to generic adapter`);
    }

    results.push({ id: agent.id, cli: agent.cli, port: agent.port, errors, warnings });
  }

  return {
    valid: results.every(r => r.errors.length === 0),
    agents: results,
  };
}

/**
 * Build a PlumbConfig for a single fleet agent.
 */
export function agentToPlumbConfig(agent: FleetAgent): PlumbConfig & { adapterName?: string } {
  return {
    cli: agent.cli,
    port: agent.port,
    name: agent.name,
    workdir: agent.workdir,
    taskTimeout: agent.timeout ?? 300,
    apiKey: agent.apiKey,
    env: agent.env,
  };
}
