// PLUMB — Server
// Express + @a2a-js/sdk. Agent Card. JSON-RPC. REST. Health.
// Stolen from fangai's createFangServer, adapted: Plumb naming, ledger injection, no Cursor.

import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from '@a2a-js/sdk/server/express';
import type { AgentAdapter, PlumbConfig } from '../types.ts';
import { Ledger } from './ledger.ts';
import { PlumbExecutor } from './executor.ts';

export function createPlumbServer(config: PlumbConfig & { adapter: AgentAdapter }) {
  const { adapter, port } = config;
  const name = config.name ?? `${adapter.displayName}-plumb`;
  const ledger = new Ledger();

  const agentCard = {
    name,
    description: `${adapter.displayName} via plumb — A2A bridge`,
    protocolVersion: '0.3.0',
    version: '0.1.0',
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
  const taskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, executor);

  return {
    executor,
    agentCard,
    ledger,
    setupApp: (app: express.Express) => {
      app.use(express.json({ limit: '10mb' }));

      // Public — Agent Card and health MUST be unauthenticated (A2A spec)
      app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
      app.get('/.well-known/agent.json', (_req: Request, res: Response) => {
        res.redirect('/.well-known/agent-card.json');
      });
      app.get('/health', (_req: Request, res: Response) => {
        res.json({
          status: 'ok',
          agent: name,
          adapter: adapter.id,
          mode: adapter.mode,
          tier: adapter.tier,
          ledger: ledger.getPath(),
        });
      });

      // Auth gate — protects A2A endpoints if apiKey is configured
      if (config.apiKey) {
        app.use((req: Request, res: Response, next: NextFunction) => {
          if (req.headers.authorization !== `Bearer ${config.apiKey}`) {
            return res.status(401).json({ error: { message: 'Unauthorized' } });
          }
          next();
        });
      }

      // A2A endpoints
      app.use('/a2a/jsonrpc', jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
      app.use('/a2a/rest', restHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
    },
  };
}
