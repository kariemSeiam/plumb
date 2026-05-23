// @plumb/adapter-gemini — Google Gemini CLI adapter for Plumb
// Wraps the `gemini` CLI (https://github.com/google-gemini/gemini-cli)

import {
  type AgentAdapter,
  type AgentTask,
  type AdapterEvent,
  type DetectionResult,
  type PlumbConfig,
  detectBinary,
  textDelta,
  statusEvent,
  errorEvent,
} from '@plumb/adapter-sdk';

class GeminiAdapter implements AgentAdapter {
  readonly id = 'gemini';
  readonly binary = 'gemini';
  readonly tier = 1 as const;
  readonly displayName = 'Gemini CLI';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'code', name: 'Code generation & editing', tags: ['code', 'edit', 'refactor'] },
    { id: 'bash', name: 'Shell command execution', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'File reading & analysis', tags: ['read', 'analyze', 'understand'] },
    { id: 'web', name: 'Web search & browsing', tags: ['web', 'search', 'browse'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    // gemini CLI reads prompt from stdin when no --prompt flag is given
    return ['--yolo'];
  }

  formatInput(task: AgentTask): string {
    return task.message + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    // Try to parse as JSON (future-proofing for --json flag)
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.type === 'error' || parsed.error) {
        return [errorEvent(String(parsed.error ?? parsed.message ?? 'unknown error'))];
      }
      if (parsed.type === 'done' || parsed.type === 'complete') {
        return [statusEvent('completed')];
      }
      if (typeof parsed.text === 'string') {
        return [textDelta(parsed.text)];
      }
    } catch { /* not JSON — treat as plain text output */ }

    return [textDelta(line + '\n')];
  }

  detect(): Promise<DetectionResult | null> {
    return detectBinary('gemini', 1, 'text', ['--version']);
  }
}

export default new GeminiAdapter();
