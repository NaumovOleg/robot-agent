import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { dispatchHint } from './dispatch';
import { takeSnapshot } from './snapshots';

const hintDiff = (
  op: string,
  anchor: string | null | undefined,
  newContent: string | null | undefined
): string => {
  const added = newContent ? `+ ${newContent.slice(0, 400)}` : '';
  if (op === 'insert_text') return added || op; // anchor is position, not removed text
  const removed = anchor ? `- ${anchor.slice(0, 200)}` : '';
  return [removed, added].filter(Boolean).join('\n') || op;
};

export const applyNode = async (state: ExecutorStateType) => {
  const { cwd, sessionId, currentStepId, currentHints } = state;
  if (!currentStepId || currentHints.length === 0) {
    return { lastError: state.lastError ?? 'apply: nothing to apply' };
  }

  // Snapshot all files this step touches — once per step. On retry the snapshot
  // already holds the pristine pre-step content; never overwrite it.
  const existing = state.fileSnapshots[currentStepId];
  const fileSnapshots = existing
    ? { [currentStepId]: existing }
    : {
        [currentStepId]: await takeSnapshot(
          cwd,
          currentHints.flatMap((h) => (h.target ? [h.file, h.target] : [h.file]))
        ),
      };

  const applied: string[] = [];
  for (let i = 0; i < currentHints.length; i++) {
    const hint = currentHints[i];
    try {
      const result = await dispatchHint(hint, cwd);
      applied.push(result.summary);
      EventBus.emit('executor:edit:applied', {
        sessionId,
        stepId: currentStepId,
        file: result.file,
        op: hint.op,
        diff:
          hint.op === 'rename_file' && hint.target
            ? `${hint.file} → ${hint.target}`
            : hintDiff(hint.op, hint.anchor, hint.newContent),
      });
    } catch (err) {
      const message = `hint ${i + 1}/${currentHints.length} (${hint.op} ${hint.file}): ${String(
        (err as Error).message ?? err
      )}`;
      debug('[executor/apply] failed:', message, err);
      return {
        fileSnapshots,
        appliedOps: { [currentStepId]: applied },
        lastError: message,
      };
    }
  }

  debug(
    '[executor/apply]',
    currentStepId,
    `applied ${applied.length} op(s):`,
    applied.map((s) => `\n    ✓ ${s}`).join('')
  );
  return { fileSnapshots, appliedOps: { [currentStepId]: applied }, lastError: null };
};
