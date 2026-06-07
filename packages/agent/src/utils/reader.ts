import { ContextService, formatProjectContext } from '@robocode-packages/core';
import { READER_PROMPT } from '../prompts';
import { SystemMessage } from '@langchain/core/messages';
import type { ReaderInput } from '@robocode-packages/shared';

export async function initializeReaderSystemMessage(
  message: ReaderInput,
  options: { cwd: string; sessionId: string }
) {
  const cwd = options.cwd;
  const projectContext = await ContextService.get(cwd);
  const contextBlock = formatProjectContext(projectContext);

  const systemMsg = new SystemMessage(
    READER_PROMPT({
      task: message.task ?? 'No task provided',
      focus: message.focus ?? [],
      instructions: message.instructions ?? '',
      context: {
        user_goal: message?.user_goal ?? 'No user goal provided',
        current_plan_step: message?.current_plan_step ?? 'No plan step provided',
        cwd,
        sessionId: options.sessionId,
      },
    }) +
      `
## Project context
${contextBlock}`
  );
  return systemMsg;
}
