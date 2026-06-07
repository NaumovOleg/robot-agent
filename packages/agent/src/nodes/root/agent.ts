import type { AIMessageChunk } from '@langchain/core/messages';
import { EventBus, ProfileConfig } from '@robocode-packages/core';
import type { RootStateType } from '@robocode-packages/shared';
import { computeCost } from '@robocode-packages/shared';
import { createBaseModel } from '../../utils';

import {
  bashTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  grepTool,
  listDirTool,
  gitDiffTool,
  gitLogTool,
  requestApprovalTool,
  renameSymbolTool,
  findDefinitionTool,
  deleteFileTool,
  verifyEditsTool,
} from '@robocode-packages/tools';

export const AGENT_TOOLS = [
  // read-only
  readFileTool,
  listDirTool,
  globTool,
  grepTool,
  findDefinitionTool,
  gitDiffTool,
  gitLogTool,

  // mutation
  writeFileTool,
  editFileTool,
  deleteFileTool,
  bashTool,
  renameSymbolTool,
  // verification
  verifyEditsTool,
  // control
  requestApprovalTool,
];

export async function rootAgentNode(state: RootStateType) {
  const { sessionId, cwd } = state;

  const profile = ProfileConfig.active();
  if (!profile) throw new Error('No active profile');

  EventBus.emit('llm:start', { sessionId });

  const model = createBaseModel(true);

  try {
    const stream = await model.stream(state.messages, {
      configurable: { sessionId, cwd },
    });

    let response: AIMessageChunk | null = null;
    for await (const chunk of stream) {
      response = response === null ? chunk : response.concat(chunk);

      const contentBlocks = Array.isArray(chunk.content)
        ? (chunk.content as { type: string; text?: string; thinking?: string }[])
        : [];

      for (const block of contentBlocks) {
        if (block.type === 'text' && block.text) {
          EventBus.emit('llm:token', { sessionId, token: block.text });
        }
        if (block.type === 'thinking' && block.thinking) {
          EventBus.emit('llm:thinking', { sessionId, text: block.thinking });
        }
      }

      if (typeof chunk.content === 'string' && chunk.content) {
        EventBus.emit('llm:token', { sessionId, token: chunk.content });
      }
    }

    const usage = response?.usage_metadata;
    if (usage) {
      const responseMeta = (
        response as unknown as {
          response_metadata?: { usage?: { cache_read_input_tokens?: number } };
        }
      )?.response_metadata;
      const cacheReadTokens = responseMeta?.usage?.cache_read_input_tokens ?? 0;
      EventBus.emit('llm:usage', {
        sessionId,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens,
        cost: computeCost(profile.model, {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          cache_read_input_tokens: cacheReadTokens,
        }),
      });
    }

    EventBus.emit('llm:end', { sessionId });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { messages: [response!] };
  } catch (err) {
    EventBus.emit('llm:error', { sessionId, error: String(err) });
    throw err;
  }
}
