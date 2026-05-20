// PLUMB — Ledger
// Append-only JSONL. Every task event is one line. Crash-survivable. Query with jq.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerEvent } from '../types.ts';
import { log } from './log.ts';

const LEDGER_DIR = '.plumb/ledger';

export class Ledger {
  private currentDate: string;
  private path: string;

  constructor() {
    if (!existsSync(LEDGER_DIR)) {
      mkdirSync(LEDGER_DIR, { recursive: true });
    }
    this.currentDate = new Date().toISOString().slice(0, 10);
    this.path = join(LEDGER_DIR, `${this.currentDate}.jsonl`);
  }

  append(event: LedgerEvent): void {
    try {
      this.rollIfNeeded();
      appendFileSync(this.path, JSON.stringify(event) + '\n');
    } catch {
      log('error', 'ledger_write_failed', { event_type: event.type });
    }
  }

  getPath(): string {
    this.rollIfNeeded();
    return this.path;
  }

  private rollIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.path = join(LEDGER_DIR, `${today}.jsonl`);
    }
  }
}
