import { execSync } from 'node:child_process';
import { AIMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { createBaseModel } from '../utils/model';
import type { RootStateType } from './state';

function tryExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

export async function summarizerNode(state: RootStateType) {
  const { sessionId, cwd } = state;

  const gitDiffStat = tryExec('git diff HEAD --stat', cwd);
  const gitDiffFull = tryExec('git diff HEAD', cwd).slice(0, 6000);

  EventBus.emit('llm:start', { sessionId });
  const llm = createBaseModel(true);

  const recentMessages = state.messages.slice(-5);
  const messagesSummary = recentMessages
    .map(
      (m) =>
        `${m._getType()}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : JSON.stringify(m.content).slice(0, 300)}`
    )
    .join('\n');

  const prompt = `You are summarizing the results of an autonomous coding session.

Git changes:
${gitDiffStat || '(no changes)'}

Full diff (truncated):
${gitDiffFull || '(none)'}

Conversation history (last 5 messages):
${messagesSummary}

Write a brief summary: what was accomplished, what files changed, any warnings or failures. Be concise (3-5 sentences).`;

  try {
    const stream = await llm.stream(prompt);

    let response: AIMessageChunk | null = null;
    for await (const chunk of stream) {
      response = response === null ? chunk : response.concat(chunk);

      const text =
        typeof chunk.content === 'string'
          ? chunk.content
          : (chunk.content as { type: string; text?: string }[])
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('');

      if (text) EventBus.emit('llm:token', { sessionId, token: text });
    }

    EventBus.emit('llm:end', { sessionId });

    const summary =
      typeof response?.content === 'string'
        ? response.content
        : JSON.stringify(response?.content ?? '');

    return { messages: [new AIMessage(summary)] };
  } catch (err) {
    EventBus.emit('llm:error', { sessionId, error: String(err) });
    return {
      messages: [new AIMessage(`Session complete. Git changes:\n${gitDiffStat || '(no changes)'}`)],
    };
  }
}
