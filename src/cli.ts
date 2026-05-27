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
import { readAllRegistrations, findRegistration, writeRegistration, unregister } from './core/registry.ts';

function readPackageVersion(): string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const raw = readFileSync(join(root, 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

import { log } from './core/log.ts';

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
  .command('status')
  .description('Check health of all fleet agents')
  .option('-c, --config <path>', 'Path to plumb.yaml')
  .option('--timeout <ms>', 'Per-agent health check timeout', '5000')
  .action(async (opts: { config?: string; timeout?: string }) => {
    const path = resolveConfigPath(opts.config);
    if (!path) {
      log('error', 'config_not_found', { searched: opts.config ?? '(default paths)' });
      process.exit(1);
    }

    const config = loadFleetConfig(path);
    if (!config) {
      log('error', 'config_empty', { path });
      process.exit(1);
    }

    const timeout = parseInt(opts.timeout ?? '5000', 10);
    log('info', 'fleet_status_check', { agentCount: config.agents.length });

    const checks = config.agents.map(async (agent) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);

        const url = `http://localhost:${agent.port}/health`;
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);

        if (res.ok) {
          const body = await res.json().catch(() => ({})) as Record<string, unknown>;
          const bodyStatus = typeof body.status === 'string' ? body.status : 'ok';
          log('info', 'fleet_agent_healthy', {
            id: agent.id,
            port: agent.port,
            status: bodyStatus,
          });
          return { id: agent.id, port: agent.port, healthy: true, status: bodyStatus };
        }

        log('warn', 'fleet_agent_unhealthy', { id: agent.id, port: agent.port, httpStatus: res.status });
        return { id: agent.id, port: agent.port, healthy: false, status: `HTTP ${res.status}` };
      } catch (err) {
        log('warn', 'fleet_agent_down', {
          id: agent.id,
          port: agent.port,
          error: err instanceof Error ? err.message : String(err),
        });
        return { id: agent.id, port: agent.port, healthy: false, status: 'unreachable' };
      }
    });

    const results = await Promise.all(checks);
    const healthy = results.filter(r => r.healthy).length;
    const total = results.length;

    log('info', 'fleet_status_summary', {
      healthy,
      total,
      allHealthy: healthy === total,
    });

    if (healthy < total) process.exit(1);
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
      type FleetServer = {
        id: string;
        port: number;
        executor: import('./core/executor.ts').PlumbExecutor;
        server: import('http').Server;
      };
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

        // Register fleet agent
        try {
          writeRegistration({
            name: agent.id,
            port: agent.port,
            pid: process.pid,
            adapter: adapter.id,
            mode: adapter.mode,
            tier: adapter.tier,
            uptime: Date.now(),
            healthUrl: `http://localhost:${agent.port}/health`,
            agentCardUrl: `http://localhost:${agent.port}/.well-known/agent-card.json`,
            jsonrpcUrl: `http://localhost:${agent.port}/a2a/jsonrpc`,
          });
        } catch { /* non-fatal */ }
      }

      log('info', 'fleet_up', { agentCount: fleetServers.length, ports: fleetServers.map(s => s.port) });

      // Graceful shutdown — mirrors wrap command behavior
      const fleetShutdown = async () => {
        log('info', 'fleet_shutdown', {});
        // Unregister all fleet agents
        for (const s of fleetServers) {
          unregister(s.id);
        }
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
  .option('--deny', 'Deny all requests when no --key is set (secure-by-default)')
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

    const { executor, setupApp, registryName } = createPlumbServer({
      adapter,
      cli,
      port,
      name: opts.name,
      workdir: opts.workdir,
      taskTimeout: parseInt(opts.timeout, 10),
      apiKey: opts.key,
      denyWithoutKey: (opts as Record<string, unknown>).deny === true,
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
      unregister(registryName);
      await executor.shutdown();
      server.close(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ─── ps command ──────────────────────────────────────────────────────

program
  .command('ps')
  .description('List all running Plumb agents')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    const regs = readAllRegistrations();

    if (opts.json) {
      console.log(JSON.stringify(regs, null, 2));
      return;
    }

    if (regs.length === 0) {
      log('info', 'no_registrations', { hint: 'No Plumb agents found in registry' });
      return;
    }

    // Table header
    const header = ['NAME', 'ADAPTER', 'MODE', 'PORT', 'PID', 'UPTIME', 'STATUS'];
    const rows: string[][] = [];

    for (const reg of regs) {
      let status = 'unknown';
      try {
        const res = await fetch(reg.healthUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const body = await res.json().catch(() => ({})) as Record<string, unknown>;
          status = typeof body.status === 'string' ? body.status : 'ok';
        } else {
          status = `HTTP ${res.status}`;
        }
      } catch {
        status = 'down';
      }

      const uptime = Math.floor((Date.now() - reg.uptime) / 1000);
      const uptimeStr = uptime < 60 ? `${uptime}s`
        : uptime < 3600 ? `${Math.floor(uptime / 60)}m`
        : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;

      rows.push([
        reg.name,
        reg.adapter,
        reg.mode,
        String(reg.port),
        String(reg.pid),
        uptimeStr,
        status,
      ]);
    }

    // Calculate column widths
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));

    // Print header
    const hLine = header.map((h, i) => h.padEnd(widths[i])).join('  ');
    console.log(hLine);
    console.log('-'.repeat(hLine.length));

    // Print rows
    for (const row of rows) {
      console.log(row.map((c, i) => c.padEnd(widths[i])).join('  '));
    }

    console.log();
    log('info', 'ps_summary', { count: regs.length });
  });

// ─── status command (single agent) ───────────────────────────────────

program
  .command('status')
  .description('Show detailed status of a Plumb agent')
  .argument('[name]', 'Agent name (omit to list all)')
  .option('--json', 'Output as JSON')
  .action(async (name?: string, opts?: { json?: boolean }) => {
    const json = opts?.json ?? false;

    if (!name) {
      // List all — delegate to ps command
      await program.parseAsync(['node', 'plumb', 'ps', ...(json ? ['--json'] : [])]);
      return;
    }

    const reg = findRegistration(name);
    if (!reg) {
      log('error', 'agent_not_found', { name, hint: 'Use plumb ps to list available agents' });
      process.exit(1);
    }

    // Get health
    let health: Record<string, unknown> = {};
    let healthy = false;
    try {
      const res = await fetch(reg.healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        health = await res.json().catch(() => ({})) as Record<string, unknown>;
        healthy = true;
      } else {
        health = { status: `HTTP ${res.status}` };
      }
    } catch (err) {
      health = { status: 'unreachable', error: err instanceof Error ? err.message : String(err) };
    }

    if (json) {
      console.log(JSON.stringify({ registration: reg, health }, null, 2));
      return;
    }

    console.log(`Agent:    ${reg.name}`);
    console.log(`Adapter:  ${reg.adapter} (tier ${reg.tier}, ${reg.mode})`);
    console.log(`Port:     ${reg.port}`);
    console.log(`PID:      ${reg.pid}`);
    console.log(`Uptime:   ${Math.floor((Date.now() - reg.uptime) / 1000)}s`);
    console.log(`Health:   ${healthy ? '✅ ' + (health.status as string ?? 'ok') : '❌ ' + (health.status as string ?? 'down')}`);
    console.log(`RPC:      ${reg.jsonrpcUrl}`);
    console.log(`Card:     ${reg.agentCardUrl}`);
  });

// ─── send command ────────────────────────────────────────────────────

program
  .command('send')
  .description('Send a message to a Plumb agent and get a response')
  .argument('<agent>', 'Agent name or URL')
  .argument('[message]', 'Message text (or read from stdin)')
  .option('--json', 'Output raw JSON response')
  .option('--port <number>', 'Target port (bypasses registry lookup)')
  .option('--url <url>', 'Target URL (bypasses registry lookup)')
  .option('--timeout <seconds>', 'Request timeout (default 300 for oneshot agent spawn)', '300')
  .option('--verbose', 'Show A2A request shape')
  .action(async (agent: string, message?: string, opts?: {
    json?: boolean;
    port?: string;
    url?: string;
    timeout?: string;
    verbose?: boolean;
  }) => {
    const jsonOutput = opts?.json ?? false;
    const verbose = opts?.verbose ?? false;
    const timeoutMs = parseInt(opts?.timeout ?? '300', 10) * 1000;

    // Resolve target URL
    let targetUrl: string;
    if (opts?.url) {
      targetUrl = opts.url.replace(/\/+$/, '') + '/a2a/jsonrpc';
    } else if (opts?.port) {
      targetUrl = `http://localhost:${opts.port}/a2a/jsonrpc`;
    } else {
      const reg = findRegistration(agent);
      if (!reg) {
        log('error', 'agent_not_found', {
          name: agent,
          hint: 'Use plumb ps to list available agents, or use --port or --url',
        });
        process.exit(1);
      }
      targetUrl = reg.jsonrpcUrl;
    }

    // Get message from argument or stdin
    let text = message;
    if (!text) {
      // Read from stdin
      const stdin = process.stdin;
      if (stdin.isTTY) {
        log('error', 'no_message', { hint: 'Provide message as argument or pipe to stdin' });
        process.exit(1);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      text = Buffer.concat(chunks).toString('utf8').trim();
    }

    if (!text) {
      log('error', 'empty_message', {});
      process.exit(1);
    }

    const messageId = `plumb-send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const rpcRequest = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId,
          role: 'user',
          kind: 'message',
          parts: [{ kind: 'text', text }],
        },
      },
    };

    if (verbose) {
      console.error('→ POST', targetUrl);
      console.error(JSON.stringify(rpcRequest, null, 2));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcRequest),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '(empty)');
        log('error', 'send_failed', { httpStatus: res.status, body: body.slice(0, 500) });
        process.exit(1);
      }

      const response = await res.json() as Record<string, unknown>;

      if (verbose) {
        console.error('←', res.status, JSON.stringify(response, null, 2));
      }

      // Extract and print response text
      if (jsonOutput) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      const result = response.result as Record<string, unknown> | undefined;

      // Extract text from response, handling both message-kind and task-kind
      let outputParts: string[] = [];

      if (result) {
        if (Array.isArray(result.parts)) {
          // message-kind: result.parts[{kind, text}]
          for (const part of result.parts) {
            const p = part as Record<string, unknown>;
            if (p.kind === 'text' && typeof p.text === 'string') {
              outputParts.push(p.text);
            }
          }
        }

        // task-kind: result.status.artifacts[{parts:[{text}]}]
        const status = result.status as Record<string, unknown> | undefined;
        if (status && Array.isArray(status.artifacts)) {
          for (const artifact of status.artifacts) {
            const a = artifact as Record<string, unknown>;
            if (Array.isArray(a.parts)) {
              for (const part of a.parts) {
                const p = part as Record<string, unknown>;
                if (typeof p.text === 'string') {
                  outputParts.push(p.text);
                }
              }
            }
          }
        }
      }

      if (outputParts.length > 0) {
        process.stdout.write(outputParts.join('') + '\n');
      } else if (response.error) {
        const err = response.error as Record<string, unknown>;
        log('error', 'rpc_error', { code: err.code, message: err.message });
        process.exit(1);
      } else {
        // Fallback: print raw JSON
        console.log(JSON.stringify(response));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('error', 'send_error', { error: msg });
      if (msg.includes('abort')) {
        log('error', 'send_timeout', { timeout: `${timeoutMs}ms` });
      }
      process.exit(1);
    }
  });

export { program };
