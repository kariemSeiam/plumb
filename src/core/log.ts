// PLUMB — Shared JSONL logger
// Structured stderr output used by process manager, CLI, and ledger fallback.

export function log(level: string, msg: string, data?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    l: level,
    m: msg,
    ...(data ?? {}),
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}
