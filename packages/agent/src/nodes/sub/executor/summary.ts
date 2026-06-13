import { debug } from '@robocode-packages/shared';
import type { ExecutorHint } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

const clip = (s: string, n = 60): string => {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n) + '…' : oneLine;
};

// One-line, human-readable description of an edit hint for the debug log.
export const summarizeHint = (h: ExecutorHint): string => {
  switch (h.op) {
    case 'rename_symbol':
      return `rename_symbol ${h.file} ${h.symbol}→${h.newSymbol}`;
    case 'rename_file':
      return `rename_file ${h.file}→${h.target}`;
    case 'replace_node':
      return `replace_node ${h.file} <${h.nodeType ?? '?'}${h.symbol ? ` ${h.symbol}` : ''}>`;
    case 'edit_text':
      return `edit_text ${h.file} @"${clip(h.oldText ?? '', 40)}"`;
    case 'create_file':
    case 'delete_file':
      return `${h.op} ${h.file}`;
    default:
      return `${h.op} ${h.file}`;
  }
};

export const summarizeHints = (hints: ExecutorHint[]): string =>
  hints.map((h, i) => `\n    ${i + 1}. ${summarizeHint(h)}`).join('');

// Compact snapshot of the loop's progress: per-step status, the current step,
// and any retry counts. Printed at the top of each iteration so the debug log
// reads like a state machine trace.
export const summarizeState = (state: ExecutorStateType): string => {
  const states = (state.plan?.steps ?? [])
    .map((s) => `${s.id}:${state.stepStates[s.id] ?? 'pending'}`)
    .join(', ');
  const retries = Object.entries(state.retryCounts)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${id}=${n}`)
    .join(', ');
  const clip = (s: string, n = 140) => {
    const one = s.replace(/\s+/g, ' ').trim();
    return one.length > n ? one.slice(0, n) + '…' : one;
  };

  const lines = [`current=${state.currentStepId ?? '—'} | steps={${states}}`];
  if (retries) lines.push(`  retries: ${retries}`);
  if (state.currentHints?.length) {
    lines.push(`  hints: ${state.currentHints.map((h) => `${h.op} ${h.file}`).join(', ')}`);
  }
  lines.push(
    `  verify: ${state.verifyPassed === true ? 'passed' : state.verifyPassed === false ? 'FAILED' : '—'}` +
      (state.errorFiles?.length ? ` | errorFiles: ${state.errorFiles.join(', ')}` : '') +
      (state.producedFiles?.length ? ` | produced: ${state.producedFiles.join(', ')}` : '')
  );
  if (state.lastError) lines.push(`  lastError: ${clip(state.lastError)}`);
  if (state.escalationDecision) lines.push(`  escalation: ${state.escalationDecision}`);
  return lines.join('\n');
};

// Wraps an executor graph node so every entry logs the node name and the live
// state snapshot. Gives the debug log a node-by-node trace of the loop's flow
// (init → step_selector → mini_reader → apply → verify_step → step_review → …).
// Generic over the node's return type so addNode's overloads still resolve.
export const traceExecutorNode =
  <R>(name: string, fn: (state: ExecutorStateType) => R): ((state: ExecutorStateType) => R) =>
  (state) => {
    debug(`[graph/executor] → ${name.padEnd(14)} ${summarizeState(state)}`);
    return fn(state);
  };
