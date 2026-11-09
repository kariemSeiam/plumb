// PLUMB — Ledger
// Append-only JSONL. Every task event is one line. Crash-survivable. Query with jq.

import { appendFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerEvent } from '../types.ts';
import { log } from './log.ts';

const LEDGER_DIR = '.plumb/ledger';

export class Ledger {
  private currentDate: string;
  private path: string;
  private _entryCount = 0;

  constructor() {
    if (!existsSync(LEDGER_DIR)) {
      mkdirSync(LEDGER_DIR, { recursive: true });
    }
    this.currentDate = new Date().toISOString().slice(0, 10);
    this.path = join(LEDGER_DIR, `${this.currentDate}.jsonl`);
    // Count existing entries on boot
    this._entryCount = this.countLines(this.path);
  }

  append(event: LedgerEvent): void {
    try {
      this.rollIfNeeded();
      appendFileSync(this.path, JSON.stringify(event) + '\n');
      this._entryCount++;
    } catch {
      log('error', 'ledger_write_failed', { event_type: event.type });
    }
  }

  getPath(): string {
    this.rollIfNeeded();
    return this.path;
  }

  /** Number of ledger entries written since boot. */
  getEntryCount(): number {
    return this._entryCount;
  }

  private countLines(filePath: string): number {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const count = raw.split('\n').filter(l => l.trim().length > 0).length;
      return count;
    } catch {
      return 0;
    }
  }

  private rollIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.path = join(LEDGER_DIR, `${today}.jsonl`);
    }
  }
}
