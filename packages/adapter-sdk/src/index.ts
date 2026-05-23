// @plumb/adapter-sdk — Public API
export type {
  TaskMetadata,
  AgentTask,
  AdapterEvent,
  PlumbConfig,
  DetectionResult,
  AgentAdapter,
} from './types.ts';

export { detectBinary } from './detect.ts';

export type { ContentBlockEvent, ParsedLine } from './stream-json.ts';
export {
  tryParseLine,
  extractContentText,
  isConsolidatedAssistant,
  textDelta,
  statusEvent,
  errorEvent,
} from './stream-json.ts';
