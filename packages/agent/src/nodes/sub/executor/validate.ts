import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { validateHint } from './dispatch';

// Dry-run resolves every hint against current disk content BEFORE any write. Files
// are untouched. Collects per-hint failures so the repair node can re-prompt only
// the broken hints — no rollback needed because nothing was applied.
export const validateNode = async (state: ExecutorStateType) => {
  const { cwd, currentHints } = state;
  const hintErrors: { index: number; op: string; file: string; reason: string }[] = [];

  for (let i = 0; i < currentHints.length; i++) {
    const hint = currentHints[i];
    try {
      await validateHint(hint, cwd);
    } catch (err) {
      hintErrors.push({
        index: i,
        op: hint.op,
        file: hint.file,
        reason: String((err as Error).message ?? err),
      });
    }
  }

  if (hintErrors.length > 0) {
    debug('[executor/validate]', `${hintErrors.length}/${currentHints.length} hint(s) failed to resolve`);
  } else {
    debug('[executor/validate]', `all ${currentHints.length} hint(s) resolve`);
  }
  return { hintErrors };
};
