// PLUMB — Config tests (Wave 2)
// Tests for plumb.yaml parsing, validation, and CLI commands.

import { describe, it, expect } from 'bun:test';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test loadFleetConfig and validateFleetConfig via import
let loadFleetConfig: typeof import('./config.ts').loadFleetConfig;
let validateFleetConfig: typeof import('./config.ts').validateFleetConfig;
let resolveConfigPath: typeof import('./config.ts').resolveConfigPath;

// Lazy import to avoid module side-effects
async function setup() {
  const mod = await import('./config.ts');
  loadFleetConfig = mod.loadFleetConfig;
  validateFleetConfig = mod.validateFleetConfig;
  resolveConfigPath = mod.resolveConfigPath;
}

function tmpFile(content: string): string {
  const p = join(tmpdir(), `plumb-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(p, content);
  return p;
}

describe('loadFleetConfig', () => {
  it('parses a valid plumb.yaml', async () => {
    await setup();
    const path = tmpFile(`
version: "1"
agents:
  - id: pi
    cli: pi
    port: 3001
    mode: persistent
  - id: cursor
    cli: cursor-agent --print
    port: 3002
`);
    const config = loadFleetConfig!(path);
    expect(config).not.toBeNull();
    expect(config!.version).toBe('1');
    expect(config!.agents).toHaveLength(2);
    expect(config!.agents[0].id).toBe('pi');
    expect(config!.agents[0].port).toBe(3001);
    expect(config!.agents[0].mode).toBe('persistent');
    expect(config!.agents[1].id).toBe('cursor');
    expect(config!.agents[1].port).toBe(3002);
    unlinkSync(path);
  });

  it('rejects missing agents field', async () => {
    await setup();
    const path = tmpFile(`version: "1"\n`);
    expect(() => loadFleetConfig!(path)).toThrow('agents');
    unlinkSync(path);
  });

  it('rejects agents without id', async () => {
    await setup();
    const path = tmpFile(`
version: "1"
agents:
  - cli: cat
    port: 3001
`);
    expect(() => loadFleetConfig!(path)).toThrow('id');
    unlinkSync(path);
  });

  it('rejects agents without cli', async () => {
    await setup();
    const path = tmpFile(`
version: "1"
agents:
  - id: test
    port: 3001
`);
    expect(() => loadFleetConfig!(path)).toThrow('cli');
    unlinkSync(path);
  });

  it('rejects invalid port', async () => {
    await setup();
    const path = tmpFile(`
version: "1"
agents:
  - id: test
    cli: cat
    port: 99999
`);
    expect(() => loadFleetConfig!(path)).toThrow('port');
    unlinkSync(path);
  });

  it('returns null when file does not exist', async () => {
    await setup();
    const result = resolveConfigPath!('/nonexistent/plumb.yaml');
    expect(result).toBeNull();
  });

  it('parses optional fields', async () => {
    await setup();
    const path = tmpFile(`
version: "1"
agents:
  - id: venom
    cli: venom --mode rpc
    port: 4000
    mode: oneshot
    timeout: 600
    labels: [heavy, deep]
    env:
      API_KEY: "\${VENOM_KEY}"
`);
    const config = loadFleetConfig!(path);
    expect(config!.agents[0].timeout).toBe(600);
    expect(config!.agents[0].labels).toEqual(['heavy', 'deep']);
    expect(config!.agents[0].env?.API_KEY).toBe('${VENOM_KEY}');
    unlinkSync(path);
  });
});

describe('validateFleetConfig', () => {
  it('detects duplicate ports', async () => {
    await setup();
    const config = {
      version: '1',
      agents: [
        { id: 'a', cli: 'cat', port: 3001 },
        { id: 'b', cli: 'cat', port: 3001 },
      ],
    };
    // validate is async, calls detectAll which does real binary checks
    // We test it runs without throw and reports errors
    const result = await validateFleetConfig!(config as any);
    expect(result.valid).toBe(false);
    const portErrors = result.agents.filter(a => a.errors.some(e => e.includes('port')));
    expect(portErrors.length).toBeGreaterThan(0);
  });

  it('detects duplicate ids', async () => {
    await setup();
    const config = {
      version: '1',
      agents: [
        { id: 'dup', cli: 'cat', port: 3001 },
        { id: 'dup', cli: 'cat', port: 3002 },
      ],
    };
    const result = await validateFleetConfig!(config as any);
    expect(result.valid).toBe(false);
    const idErrors = result.agents.filter(a => a.errors.some(e => e.includes('duplicate agent id')));
    expect(idErrors.length).toBeGreaterThan(0);
  });

  it('passes for a valid single-agent config', async () => {
    await setup();
    const config = {
      version: '1',
      agents: [
        { id: 'echo', cli: 'cat', port: 3099 },
      ],
    };
    const result = await validateFleetConfig!(config as any);
    expect(result.valid).toBe(true);
  });
});
