// PLUMB — Server
// Express + @a2a-js/sdk. Agent Card. JSON-RPC. REST. Health.
// Derived from prior bridge layout: Plumb naming, ledger injection, no vendor IDE coupling.

import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import { DefaultRequestHandler } from '@a2a-js/sdk/server';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '@a2a-js/sdk/server/express';
import type { AgentAdapter, PlumbConfig } from '../types.ts';
import { Ledger } from './ledger.ts';
import { PlumbExecutor } from './executor.ts';
import { PlumbTaskStore } from './task-store.ts';
import { writeRegistration } from './registry.ts';

let _pkgVersion: string | undefined;
function getPackageVersion(): string {
  if (_pkgVersion !== undefined) return _pkgVersion;
  try {
    const { readFileSync } = require('node:fs');
    const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
    _pkgVersion = pkg.version ?? '0.0.0';
  } catch {
    _pkgVersion = '0.0.0';
  }
  return _pkgVersion!;
}

export function createPlumbServer(config: PlumbConfig & { adapter: AgentAdapter }) {
  const { adapter, port } = config;
  const name = config.name ?? `${adapter.displayName}-plumb`;
  const ledger = new Ledger();

  const agentCard = {
    name,
    description: `${adapter.displayName} via plumb — A2A bridge`,
    protocolVersion: '0.3.0',
    version: getPackageVersion(),
    url: process.env.PLUMB_PUBLIC_URL ?? `http://localhost:${port}`,
    capabilities: { streaming: true },
    skills: adapter.skills.map(s => ({ ...s, description: s.name })),
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    metadata: {
      bridge: 'plumb',
      tier: adapter.tier,
      mode: adapter.mode,
      ledger: ledger.getPath(),
    },
  };

  const executor = new PlumbExecutor(adapter, config, ledger);
  const taskStore = new PlumbTaskStore({ maxTasks: 100, completedRetentionMinutes: 60 });
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, executor);

  // Periodic cleanup: evict terminal tasks past retention window every 5 min
  const cleanupInterval = setInterval(() => {
    taskStore.cleanupStaleCompleted();
  }, 5 * 60 * 1000);
  // Don't hold the process open
  if (cleanupInterval.unref) cleanupInterval.unref();

  const startTime = Date.now();

  // Register in the filesystem registry
  const pid = process.pid;
  try {
    writeRegistration({
      name,
      port,
      pid,
      adapter: adapter.id,
      mode: adapter.mode,
      tier: adapter.tier,
      uptime: Date.now(),
      healthUrl: `http://localhost:${port}/health`,
      agentCardUrl: `http://localhost:${port}/.well-known/agent-card.json`,
      jsonrpcUrl: `http://localhost:${port}/a2a/jsonrpc`,
    });
  } catch { /* non-fatal */ }

  return {
    executor,
    agentCard,
    ledger,
    taskStore,
    /** Name used for registry. Call unregister() during shutdown. */
    registryName: name,
    setupApp: (app: express.Express) => {
      app.use(express.json({ limit: `${config.maxRequestBytes ?? 10_485_760}` })); // Default 10MB

      // Public — Agent Card and health MUST be unauthenticated (A2A spec)
      app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
      app.get('/.well-known/agent.json', (_req: Request, res: Response) => {
        res.redirect('/.well-known/agent-card.json');
      });
      app.get('/health', (_req: Request, res: Response) => {
        const health: Record<string, unknown> = {
          status: 'ok',
          agent: name,
          adapter: adapter.id,
          mode: adapter.mode,
          tier: adapter.tier,
          ledger: ledger.getPath(),
          ledgerEntries: ledger.getEntryCount(),
          uptime: Math.floor((Date.now() - startTime) / 1000),
        };
        const alive = executor.isPersistentAlive();
        if (alive !== null) {
          health.agentAlive = alive;
        }
        res.json(health);
      });

      // Auth gate — protects A2A endpoints
      if (config.apiKey) {
        // Key-based auth: reject if Bearer token doesn't match
        const expected = Buffer.from(`Bearer ${config.apiKey}`);
        app.use((req: Request, res: Response, next: NextFunction) => {
          const header = req.headers.authorization ?? '';
          const given = Buffer.from(header);
          if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
            return res.status(401).json({ error: { message: 'Unauthorized' } });
          }
          next();
        });
      } else if (config.denyWithoutKey) {
        // Deny mode: reject all requests without a key
        app.use((_req: Request, res: Response) => {
          res.status(401).json({ error: { message: 'Unauthorized — no API key configured, deny mode active' } });
        });
      }

      // A2A endpoints
      app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
      app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
    },
  };
}
