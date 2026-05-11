import { ToolMessage, type AIMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import { ALL_TOOLS } from '@robocode-packages/tools';
import type { AgentStateType } from '../state';
import type { RunnableConfig } from '@langchain/core/runnables';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolMap = new Map<string, any>(ALL_TOOLS.map((t) => [t.name, t]));

const cache = new Map<string, string>();

export const toolsNode = async (state: AgentStateType, config?: RunnableConfig) => {
  const { sessionId } = state;
  const last = state.messages.at(-1) as AIMessage;
  if (!last?.tool_calls?.length) return {};
  debug('TOOL CALLL INVOKED', last);
  const toolMessages = await Promise.all(
    last.tool_calls.map(async (toolCall) => {
      const callId = toolCall.id ?? crypto.randomUUID();
      const tool = toolMap.get(toolCall.name);

      debug('TOOL CALLL INVOKED', tool);

      if (!tool) {
        return new ToolMessage({
          content: `Error: unknown tool "${toolCall.name}"`,
          tool_call_id: callId,
        });
      }

      // Compose cache key for tool deduplication
      const cacheKey = `${toolCall.name}:${JSON.stringify(toolCall.args)}`;

      if (cache.has(cacheKey)) {
        debug('toolsNode: cache hit', cacheKey);
        const cachedContent = cache.get(cacheKey) as string;

        return new ToolMessage({ content: cachedContent, tool_call_id: callId });
      }

      EventBus.emit('tool:start', { sessionId, name: toolCall.name, input: toolCall.args, callId });

      try {
        debug('TOOL:', toolCall.name, toolCall.args);
        const output = await tool.invoke(toolCall.args as Record<string, unknown>, config);

        const content = typeof output === 'string' ? output : JSON.stringify(output);
        cache.set(cacheKey, content);
        EventBus.emit('tool:end', { sessionId, name: toolCall.name, output: content, callId });
        return new ToolMessage({ content, tool_call_id: callId });
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        EventBus.emit('tool:error', { sessionId, name: toolCall.name, error, callId });
        return new ToolMessage({ content: `Error: ${error}`, tool_call_id: callId });
      }
    })
  );

  return { messages: toolMessages };
};
