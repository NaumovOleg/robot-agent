// Re-export shim: resolves the '../../base' import in subagents/reader/index.ts
// after the main/ reorganisation (agent refactor debris).
export { Agent } from './main/base';
