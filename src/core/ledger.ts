// PLUMB — Ledger
// Append-only JSONL. Every task event is one line. Crash-survivable. Query with jq.
// Stolen from pi's append-only tree storage, simplified to linear per-day files.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerEvent } from '../types.ts';

const LEDGER_DIR = '.plumb/ledger';

export class Ledger {
  private path: string;

  constructor() {
    if (!existsSync(LEDGER_DIR)) {
      mkdirSync(LEDGER_DIR, { recursive: true });
    }
    const date = new Date().toISOString().slice(0, 10);
    this.path = join(LEDGER_DIR, `${date}.jsonl`);
  }

  append(event: LedgerEvent): void {
    try {
      appendFileSync(this.path, JSON.stringify(event) + '\n');
    } catch {
      // Ledger failure is non-fatal. Log to stderr and continue.
      process.stderr.write(JSON.stringify({
        ts: new Date().toISOString(),
        l: 'error',
        m: 'ledger_write_failed',
        event_type: event.type,
      }) + '\n');
    }
  }

  getPath(): string {
    return this.path;
  }
}
