import { EventBus } from '@robocode-packages/core';
import { debug, runCommand } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { findRelatedTestFile } from './relatedTest';
import { parseTscErrors, newTscErrors } from './tscErrors';

const TAIL = 1200;
const tail = (s: string): string => (s.length > TAIL ? '…' + s.slice(-TAIL) : s);

export const verifyStepNode = async (state: ExecutorStateType) => {
  const { cwd, sessionId, currentStepId, verifyCommands, plan, baselineErrors } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!currentStepId || !step) return { lastError: 'verify: no current step' };

  // Tier 2a: type check — compare against the baseline captured at init so the
  // step is only blamed for errors it newly introduced, not pre-existing noise.
  if (verifyCommands.typeCheck) {
    const result = await runCommand(verifyCommands.typeCheck, cwd);
    const introduced = newTscErrors(parseTscErrors(result.output), baselineErrors);
    const failed = introduced.length > 0;
    EventBus.emit('executor:step:verify', {
      sessionId, stepId: currentStepId, command: verifyCommands.typeCheck, ok: !failed,
      output: failed ? introduced.join('\n').slice(-TAIL) : undefined,
    });
    if (failed) {
      debug('[executor/verify] typeCheck introduced', introduced.length, 'new errors');
      const detail = introduced.join('\n');
      return {
        lastError: `Type check failed — new errors introduced by this edit:\n${tail(detail)}`,
        verifyOutput: tail(detail),
      };
    }
  }

  // Tier 2b: related test files only — never the whole suite
  let testOutput: string | null = null;
  if (verifyCommands.testRunner) {
    for (const file of step.files) {
      const testFile = await findRelatedTestFile(file, cwd);
      if (!testFile) continue;
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
        };
      }
      testOutput = tail(result.output);
    }
  }

  return { lastError: null, verifyOutput: testOutput };
};
