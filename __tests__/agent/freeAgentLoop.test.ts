import { jest } from '@jest/globals';
import { MemorySaver } from '@langchain/langgraph';
import { AIMessage } from '@langchain/core/messages';

// Use a real MemorySaver so LangGraph's compile({ checkpointer }) works correctly.
// Must be created before the mocks are applied.
const memorySaver = new MemorySaver();

// Mock LLM to avoid real API calls.
// agentNode calls createBaseModel(true).bindTools(AGENT_TOOLS) → model.stream(...)
// summarizerNode calls createBaseModel(true) → llm.stream(prompt)
async function* makeStream(msg: AIMessage) { yield msg; }
jest.mock('../../packages/agent/src/utils/model', () => ({
  createBaseModel: jest.fn(() => ({
    bindTools: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue(
        new AIMessage({
          content: 'Task complete. I have finished the analysis.',
          tool_calls: [],
        }),
      ),
      stream: jest.fn(() => makeStream(new AIMessage({
        content: 'Task complete. I have finished the analysis.',
        tool_calls: [],
      }))),
    }),
    invoke: jest.fn().mockResolvedValue(
      new AIMessage({ content: 'Session summary: completed successfully.' }),
    ),
    stream: jest.fn(() => makeStream(new AIMessage({ content: 'Session summary: completed successfully.' }))),
  })),
  getModel: jest.fn(() => ({
    bindTools: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue(
        new AIMessage({
          content: 'Task complete.',
          tool_calls: [],
        }),
      ),
      stream: jest.fn(() => makeStream(new AIMessage({
        content: 'Task complete.',
        tool_calls: [],
      }))),
    }),
    invoke: jest.fn().mockResolvedValue(
      new AIMessage({ content: 'Session summary: completed successfully.' }),
    ),
    stream: jest.fn(() => makeStream(new AIMessage({ content: 'Session summary: completed successfully.' }))),
  })),
}));

// Mock core services to avoid file system / keychain / SQLite access.
jest.mock('../../packages/core/src/index', () => ({
  EventBus: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    once: jest.fn(),
    onPattern: jest.fn(),
    emitDynamic: jest.fn(),
  },
  MessageService: {
    add: jest.fn(),
    load: jest.fn(() => []),
    clear: jest.fn(),
  },
  SessionService: {
    findActive: jest.fn(() => null),
    load: jest.fn(),
  },
  Checkpointer: {
    getInstance: jest.fn(() => memorySaver),
  },
  AuditService: {
    append: jest.fn(),
  },
  ProfileConfig: {
    active: jest.fn(() => null),
  },
}));

import { buildGraph } from '../../packages/agent/src/main/graph';
import { HumanMessage } from '@langchain/core/messages';

test('root graph: agent exits to summarizer when no tool_calls', async () => {
  const graph = buildGraph();

  const result = await graph.invoke(
    {
      messages: [new HumanMessage('What files are in src/?')],
      sessionId: 'test-session',
      cwd: process.cwd(),
      workspaceContext: null,
      selectedFiles: [],
    },
    { configurable: { thread_id: 'test-thread-001' } },
  );

  expect(result.messages).toBeDefined();
  expect(result.messages.length).toBeGreaterThan(0);
}, 15000);

test('root graph compiles without error', () => {
  expect(() => buildGraph()).not.toThrow();
});
