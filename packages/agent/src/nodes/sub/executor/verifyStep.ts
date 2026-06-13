import { EventBus } from '@robocode-packages/core';
import { debug, runCommand } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { findRelatedTestFile } from './relatedTest';
import { parseVerifyErrors, newVerifyErrors, errorFilesFrom } from './verifyErrors';
import { isIgnoredPath } from './ignorePaths';

const TAIL = 1200;
const tail = (s: string): string => (s.length > TAIL ? '…' + s.slice(-TAIL) : s);
const MUTATING = new Set(['edit', 'create', 'delete']);

// True when no OTHER mutating step is still pending — i.e. this is the last edit
// of the plan. The whole-project type check is deferred to this point because
// intermediate states are legitimately broken (an import added before its file
// exists, a route case added before the type union is updated, …); checking
// per-step would fail those false negatives.
const isLastMutation = (state: ExecutorStateType): boolean => {
  const { plan, currentStepId, stepStates } = state;
  return !(plan?.steps ?? []).some(
    (s) =>
      s.id !== currentStepId &&
      MUTATING.has(s.kind) &&
      (stepStates[s.id] === 'pending' || stepStates[s.id] === 'running')
  );
};

export const verifyStepNode = async (state: ExecutorStateType) => {
  const { cwd, sessionId, currentStepId, verifyCommands, plan, baselineErrors } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!currentStepId || !step) return { lastError: 'verify: no current step' };

  let ranAnyCheck = false;

  // Type check ONLY at the final mutation of the plan (see isLastMutation).
  if (verifyCommands.typeCheck && isLastMutation(state)) {
    ranAnyCheck = true;
    const result = await runCommand(verifyCommands.typeCheck, cwd);
    // Ignore errors in generated/vendor output (dist, node_modules, …): the loop
    // edits source, not build artifacts, so it could never fix those anyway.
    const introduced = newVerifyErrors(parseVerifyErrors(result.output), baselineErrors).filter(
      (sig) => {
        const file = sig.split('|')[0]?.trim();
        return !(file && file !== sig && isIgnoredPath(file));
      }
    );
    const failed = introduced.length > 0;
    EventBus.emit('executor:step:verify', {
      sessionId, stepId: currentStepId, command: verifyCommands.typeCheck, ok: !failed,
      output: failed ? introduced.join('\n').slice(-TAIL) : undefined,
    });
    if (failed) {
      const errorFiles = errorFilesFrom(introduced);
      debug(
        '[executor/verify]',
        currentStepId,
        `final typeCheck has ${introduced.length} NEW error(s) in ${errorFiles.join(', ') || '?'}:`,
        introduced.map((e) => `\n    ✗ ${e}`).join('')
      );
      const detail = introduced.join('\n');
      return {
        lastError: `Type check failed — fix these errors (you may edit the files they point to):\n${tail(detail)}`,
        verifyOutput: tail(detail),
        verifyPassed: false,
        errorFiles,
      };
    }
    debug('[executor/verify]', currentStepId, 'final typeCheck OK (no new errors)');
  }

  // Tier 2b: related test files only — never the whole suite
  let testOutput: string | null = null;
  if (verifyCommands.testRunner) {
    for (const file of step.files) {
      const testFile = await findRelatedTestFile(file, cwd);
      if (!testFile) continue;
      ranAnyCheck = true;
      const quoted = `'${testFile.replace(/'/g, `'\\''`)}'`;
      const cmd = `${verifyCommands.testRunner} ${quoted}`;
      const result = await runCommand(cmd, cwd);
      EventBus.emit('executor:step:verify', {
        sessionId, stepId: currentStepId, command: cmd, ok: result.ok,
        output: result.ok ? undefined : tail(result.output),
      });
      if (!result.ok) {
        debug('[executor/verify] tests failed for', testFile);
        return {
          lastError: `Tests failed (${testFile}):\n${tail(result.output)}`,
          verifyOutput: tail(result.output),
          verifyPassed: false,
        };
      }
      testOutput = tail(result.output);
    }
  }

  return {
    lastError: null,
    verifyOutput: testOutput,
    verifyPassed: ranAnyCheck ? true : null,
    errorFiles: [],
  };
};
