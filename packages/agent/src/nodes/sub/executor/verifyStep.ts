import { EventBus } from '@robocode-packages/core';
import { debug, runCommand } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { findRelatedTestFile } from './relatedTest';

const TAIL = 1200;
const tail = (s: string): string => (s.length > TAIL ? '…' + s.slice(-TAIL) : s);

export const verifyStepNode = async (state: ExecutorStateType) => {
  const { cwd, sessionId, currentStepId, verifyCommands, plan } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!currentStepId || !step) return { lastError: 'verify: no current step' };

  // Tier 2a: type check
  if (verifyCommands.typeCheck) {
    const result = await runCommand(verifyCommands.typeCheck, cwd);
    const failed = !result.ok || /(\berror TS\d+)|(\berror\[)|((^|\s)error:)/m.test(result.output);
    EventBus.emit('executor:step:verify', {
      sessionId, stepId: currentStepId, command: verifyCommands.typeCheck, ok: !failed,
      output: failed ? tail(result.output) : undefined,
    });
    if (failed) {
      debug('[executor/verify] typeCheck failed');
      return {
        lastError: `Type check failed:\n${tail(result.output)}`,
        verifyOutput: tail(result.output),
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
