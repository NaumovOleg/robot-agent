import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import {
  debug,
  messageType,
  isAIMessage,
  isToolMessage,
  isHumanMessage,
} from '@robocode-packages/shared';
import { MessageService, SessionService } from '@robocode-packages/core';

const stableStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const messageKey = (msg: BaseMessage): string => {
  const parts: string[] = [messageType(msg)];
  const id = (msg as { id?: string | number | null }).id;
  if (id !== undefined && id !== null && String(id).length > 0) {
    parts.push(`id:${String(id)}`);
  }

  if (isAIMessage(msg) && msg.tool_calls?.length) {
    parts.push(
      `tools:${msg.tool_calls.map((call) => `${call.name ?? ''}:${call.id ?? ''}`).join('|')}`
    );
  }

  if (isToolMessage(msg)) {
    parts.push(`tool_call_id:${msg.tool_call_id}`);
    if (msg.name) {
      parts.push(`name:${msg.name}`);
    }
  }

  parts.push(`content:${stableStringify(msg.content)}`);
  return parts.join('::');
};

const chainKeys = (messages: BaseMessage[]) => messages.map(messageKey);

const longestSuffixPrefixOverlap = (left: BaseMessage[], right: BaseMessage[]): number => {
  const leftKeys = chainKeys(left);
  const rightKeys = chainKeys(right);
  const maxOverlap = Math.min(leftKeys.length, rightKeys.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const leftSlice = leftKeys.slice(leftKeys.length - overlap);
    const rightSlice = rightKeys.slice(0, overlap);
    if (leftSlice.every((key, index) => key === rightSlice[index])) {
      return overlap;
    }
  }

  return 0;
};

export const mergeMessageChains = (
  existing: BaseMessage[],
  incoming: BaseMessage[]
): BaseMessage[] => {
  const base = sanitizeToolChain(existing);
  const next = sanitizeToolChain(incoming);

  if (base.length === 0) return next;
  if (next.length === 0) return base;

  const baseKeys = chainKeys(base);
  const nextKeys = chainKeys(next);

  const isPrefix = (outer: string[], inner: string[]) =>
    outer.length <= inner.length && outer.every((key, index) => key === inner[index]);

  if (isPrefix(baseKeys, nextKeys)) return next;
  if (isPrefix(nextKeys, baseKeys)) return base;

  const overlap = longestSuffixPrefixOverlap(base, next);
  if (overlap > 0) {
    return sanitizeToolChain([...base, ...next.slice(overlap)]);
  }

  return sanitizeToolChain([...base, ...next]);
};

export const validateToolChain = (messages: BaseMessage[]) => {
  const errors: string[] = [];
  const pendingToolCalls = new Map<string, { messageIndex: number; toolName?: string }>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (isAIMessage(msg)) {
      const toolCalls = msg.tool_calls ?? [];
      for (const call of toolCalls) {
        if (!call.id) {
          errors.push(`[${i}] AI tool call missing id (${call.name ?? 'unknown'})`);
          continue;
        }

        if (pendingToolCalls.has(call.id)) {
          errors.push(`[${i}] duplicate tool_call_id detected: ${call.id}`);
          continue;
        }

        pendingToolCalls.set(call.id, { messageIndex: i, toolName: call.name });
      }
    }

    if (isToolMessage(msg)) {
      const toolCallId = msg.tool_call_id;

      if (!toolCallId) {
        errors.push(`[${i}] ToolMessage missing tool_call_id`);
        continue;
      }

      const pending = pendingToolCalls.get(toolCallId);

      if (!pending) {
        errors.push(
          `[${i}] ToolMessage references unknown tool_call_id: ${JSON.stringify(msg, null, 1.5)}`
        );

        continue;
      }

      pendingToolCalls.delete(toolCallId);
    }

    if (isHumanMessage(msg) && pendingToolCalls.size > 0) {
      const unresolved = [...pendingToolCalls.keys()];

      errors.push(
        `[${i}] HumanMessage encountered before tool results resolved: ${unresolved.join(', ')}`
      );
    }
  }

  if (pendingToolCalls.size > 0) {
    for (const [toolCallId, info] of pendingToolCalls.entries()) {
      errors.push(
        `Unresolved tool call "${toolCallId}" from AI message index ${info.messageIndex}`
      );
    }
  }

  return {
    valid: errors.length === 0,

    errors,
  };
};

export const sanitizeToolChain = (messages: BaseMessage[]): BaseMessage[] => {
  const output: BaseMessage[] = [];
  let pendingBuffer: BaseMessage[] | null = null;
  let pendingToolCalls = new Set<string>();

  const resetPending = () => {
    pendingBuffer = null;
    pendingToolCalls = new Set<string>();
  };

  for (const msg of messages) {
    if (pendingBuffer) {
      if (isToolMessage(msg)) {
        if (!pendingToolCalls.has(msg.tool_call_id)) {
          resetPending();
        } else {
          pendingBuffer.push(msg);
          pendingToolCalls.delete(msg.tool_call_id);
          if (pendingToolCalls.size === 0) {
            output.push(...pendingBuffer);
            resetPending();
          }
          continue;
        }
      } else {
        resetPending();
      }
    }

    if (!pendingBuffer) {
      if (isToolMessage(msg)) {
        continue;
      }

      if (isAIMessage(msg) && msg.tool_calls?.length) {
        pendingBuffer = [msg];
        pendingToolCalls = new Set(
          msg.tool_calls.map((call) => call.id).filter((id): id is string => Boolean(id))
        );

        if (pendingToolCalls.size === 0) {
          output.push(msg);
          resetPending();
        }

        continue;
      }

      output.push(msg);
    }
  }

  return output;
};

export const extractNewMessages = (before: BaseMessage[], after: BaseMessage[]): BaseMessage[] => {
  const normalizedBefore = sanitizeToolChain(before);
  const normalizedAfter = sanitizeToolChain(after);
  if (normalizedAfter.length === 0) return [];

  const beforeKeys = chainKeys(normalizedBefore);
  const afterKeys = chainKeys(normalizedAfter);

  if (
    beforeKeys.length > 0 &&
    beforeKeys.length <= afterKeys.length &&
    beforeKeys.every((key, index) => key === afterKeys[index])
  ) {
    const newMessages = normalizedAfter.slice(beforeKeys.length);

    if (newMessages[0] instanceof ToolMessage) {
      const toolCallId = newMessages[0].tool_call_id;
      const parentAI = [...normalizedBefore]
        .reverse()
        .find((m) => m instanceof AIMessage && m.tool_calls?.some((tc) => tc.id === toolCallId));
      if (!parentAI) {
        debug('[runAgent] WARNING: ToolMessage has no parent AIMessage');
      }
    }

    return newMessages;
  }

  const overlap = longestSuffixPrefixOverlap(normalizedBefore, normalizedAfter);
  const newMessages = normalizedAfter.slice(overlap);

  if (newMessages[0] instanceof ToolMessage) {
    const toolCallId = newMessages[0].tool_call_id;
    const parentAI = [...normalizedBefore]
      .reverse()
      .find((m) => m instanceof AIMessage && m.tool_calls?.some((tc) => tc.id === toolCallId));
    if (!parentAI) {
      debug('[runAgent] WARNING: ToolMessage has no parent AIMessage');
    }
  }

  return newMessages;
};

export const saveNewMessages = (sessionId: string, messages: BaseMessage[]) => {
  const existing = MessageService.load(sessionId);

  const fullChain = mergeMessageChains(existing, messages);
  if (fullChain.length === existing.length) {
    const existingKeys = chainKeys(existing);
    const fullKeys = chainKeys(fullChain);
    const unchanged = existingKeys.every((key, index) => key === fullKeys[index]);

    if (unchanged) {
      return;
    }
  }

  const { valid, errors } = validateToolChain(fullChain);
  if (!valid) {
    debug('[saveNewMessages] broken tool chain:', errors);
  }

  MessageService.save(sessionId, fullChain);
  SessionService.updateMessageCount(sessionId, MessageService.count(sessionId));
};
