// PLUMB — CLI
// plumb wrap <cli> --port <n>
// That's the interface. Nothing else.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import express from 'express';
import { createPlumbServer } from './core/server.ts';
import { detectAdapter, detectAll } from './adapters/registry.ts';
import { loadFleetConfig, validateFleetConfig, agentToPlumbConfig, resolveConfigPath } from './config.ts';

function readPackageVersion(): string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const raw = readFileSync(join(root, 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function log(level: string, msg: string, data?: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify({
    ts: new Date().toISOString(),
    l: level,
    m: msg,
    ...(data ?? {}),
  }) + '\n');
}

const program = new Command()
  .name('plumb')
  .description('Quiet pipes for noisy agents. A2A bridge for any CLI coding agent.')
  .version(readPackageVersion());

// ─── Fleet commands (Wave 2) ────────────────────────────────────────────

const fleet = program
  .command('fleet')
  .description('Manage multi-agent fleet (plumb.yaml)');

fleet
  .command('validate')
  .description('Parse and validate plumb.yaml')
  .option('-c, --config <path>', 'Path to plumb.yaml')
  .action(async (opts: { config?: string }) => {
    const path = resolveConfigPath(opts.config);
    if (!path) {
      log('error', 'config_not_found', { searched: opts.config ?? '(default paths)' });
      process.exit(1);
    }

    try {
      const config = loadFleetConfig(path);
      if (!config) {
        log('error', 'config_empty', { path });
        process.exit(1);
      }

      log('info', 'config_parsed', { path, agentCount: config.agents.length });

      const validation = await validateFleetConfig(config);
      for (const agent of validation.agents) {
        if (agent.errors.length > 0) {
          for (const e of agent.errors) log('error', 'validation_error', { agent: agent.id, error: e });
        }
        if (agent.warnings.length > 0) {
          for (const w of agent.warnings) log('warn', 'validation_warning', { agent: agent.id, warning: w });
        }
      }

      if (!validation.valid) {
        log('error', 'validation_failed', { agentCount: config.agents.length });
        process.exit(1);
      }

      log('info', 'validation_passed', { agentCount: config.agents.length });
    } catch (err) {
      log('error', 'config_error', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  });

fleet
  .command('up')
  .description('Boot all agents defined in plumb.yaml')
  .option('-c, --config <path>', 'Path to plumb.yaml')
  .action(async (opts: { config?: string }) => {
    const path = resolveConfigPath(opts.config);
    if (!path) {
      log('error', 'config_not_found', { searched: opts.config ?? '(default paths)' });
      process.exit(1);
    }

    try {
      const config = loadFleetConfig(path);
      if (!config) {
        log('error', 'config_empty', { path });
        process.exit(1);
      }

      const validation = await validateFleetConfig(config);
      if (!validation.valid) {
        for (const agent of validation.agents) {
          for (const e of agent.errors) log('error', 'validation_error', { agent: agent.id, error: e });
        }
        log('error', 'fleet_up_aborted', { reason: 'validation_failed' });
        process.exit(1);
      }

      // Spawn all agents
      type FleetServer = { id: string; port: number; executor: import('./core/executor.ts').PlumbExecutor; server: import('http').Server };
      const fleetServers: FleetServer[] = [];
      for (const agent of config.agents) {
        const adapter = detectAdapter(agent.cli);
        log('info', 'fleet_spawning', { id: agent.id, cli: agent.cli, port: agent.port, adapter: adapter.id });

        const { executor, setupApp } = createPlumbServer({
          ...agentToPlumbConfig(agent),
          adapter,
        });

        const app = express();
        setupApp(app);

        const server = app.listen(agent.port, () => {
          log('info', 'fleet_agent_up', { id: agent.id, port: agent.port });
        });

        fleetServers.push({ id: agent.id, port: agent.port, executor, server });
      }

      log('info', 'fleet_up', { agentCount: fleetServers.length, ports: fleetServers.map(s => s.port) });

      // Graceful shutdown — mirrors wrap command behavior
      const fleetShutdown = async () => {
        log('info', 'fleet_shutdown', {});
        await Promise.allSettled(fleetServers.map(s => s.executor.shutdown()));
        await Promise.allSettled(fleetServers.map(s => new Promise<void>(r => s.server.close(() => r()))));
        process.exit(0);
      };

      process.on('SIGINT', fleetShutdown);
      process.on('SIGTERM', fleetShutdown);

      // Block until signal
      await new Promise<void>(() => {});
    } catch (err) {
      log('error', 'fleet_up_error', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  });

// ─── Wrap command ────────────────────────────────────────────────────

program
  .command('wrap <cli>')
  .description('Wrap a CLI agent as an A2A server')
  .option('-p, --port <number>', 'Port to listen on', '3001')
  .option('--name <name>', 'Agent name override')
  .option('--workdir <dir>', 'Working directory for the CLI agent')
  .option('--timeout <seconds>', 'Task timeout in seconds', '300')
  .option('--key <apiKey>', 'Bearer token for /a2a endpoints')
  .action((cli: string, opts: {
    port: string;
    name?: string;
    workdir?: string;
    timeout: string;
    key?: string;
  }) => {
    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      log('error', 'invalid_port', { port: opts.port });
      process.exit(1);
    }

    const adapter = detectAdapter(cli);
    log('info', 'adapter_detected', { cli, adapter: adapter.id, mode: adapter.mode, tier: adapter.tier });

    // Boot-time adapter matrix — logs all registered adapters once
    detectAll().then(results => {
      log('info', 'adapter_matrix', { results });
    }).catch(err => {
      log('warn', 'adapter_matrix_error', { error: err instanceof Error ? err.message : String(err) });
    });

    const { executor, setupApp } = createPlumbServer({
      adapter,
      cli,
      port,
      name: opts.name,
      workdir: opts.workdir,
      taskTimeout: parseInt(opts.timeout, 10),
      apiKey: opts.key,
    });

    const app = express();
    setupApp(app);

    const server = app.listen(port, () => {
      log('info', 'plumb_listening', {
        port,
        adapter: adapter.id,
        mode: adapter.mode,
        endpoints: {
          agentCard: `http://localhost:${port}/.well-known/agent-card.json`,
          jsonrpc: `http://localhost:${port}/a2a/jsonrpc`,
          rest: `http://localhost:${port}/a2a/rest`,
          health: `http://localhost:${port}/health`,
        },
      });
    });

    const shutdown = async () => {
      log('info', 'plumb_shutdown', {});
      await executor.shutdown();
      server.close(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

export { program };
