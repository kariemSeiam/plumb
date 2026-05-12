// PLUMB — CLI
// plumb wrap <cli> --port <n>
// That's the interface. Nothing else.

import { Command } from 'commander';
import express from 'express';
import { createPlumbServer } from './core/server.ts';
import { detectAdapter } from './adapters/registry.ts';

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
  .version('0.1.0');

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
