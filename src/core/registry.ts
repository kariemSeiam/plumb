// PLUMB — Registry
// Filesystem-based agent discovery. Every plumb wrap instance writes a
// registration file on boot and deletes it on shutdown.
// No daemon. No lock. No consensus. Just files.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentRegistration {
  name: string;
  port: number;
  pid: number;
  adapter: string;
  mode: 'oneshot' | 'persistent';
  tier: number;
  uptime: number; // process start Unix ms
  healthUrl: string;
  agentCardUrl: string;
  jsonrpcUrl: string;
}

const ENV_KEY = 'PLUMB_REGISTRY_DIR';
const DEFAULT_DIR = '.plumb/registry';

function getRegistryDir(): string {
  const env = process.env[ENV_KEY];
  if (env) return env;

  // Prefer XDG_RUNTIME_DIR for ephemeral registrations
  const xdg = process.env['XDG_RUNTIME_DIR'];
  if (xdg) return join(xdg, 'plumb-registry');

  return join(process.cwd(), DEFAULT_DIR);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function writeRegistration(reg: AgentRegistration): void {
  const dir = getRegistryDir();
  ensureDir(dir);

  const file = join(dir, `${reg.name}.json`);
  const data = JSON.stringify(reg, null, 2);

  // Atomic write: write to temp, then rename
  const tmp = file + '.tmp';
  writeFileSync(tmp, data, 'utf8');
  try {
    renameSync(tmp, file);
  } catch {
    // Fallback: direct write (not atomic, but better than silent failure)
    writeFileSync(file, data, 'utf8');
    try { rmSync(tmp); } catch { /* ignore cleanup failure */ }
  }
}

export function unregister(name: string): void {
  const dir = getRegistryDir();
  const file = join(dir, `${name}.json`);
  try {
    rmSync(file);
  } catch {
    // File may already be gone from a prior shutdown
  }
}

export function readAllRegistrations(): AgentRegistration[] {
  const dir = getRegistryDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const registrations: AgentRegistration[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf8');
      const reg = JSON.parse(raw) as AgentRegistration;
      registrations.push(reg);
    } catch {
      // Skip corrupt registration files (e.g. half-written from crash)
    }
  }

  return registrations;
}

export function findRegistration(name: string): AgentRegistration | null {
  const regs = readAllRegistrations();
  return regs.find(r => r.name === name) ?? null;
}
