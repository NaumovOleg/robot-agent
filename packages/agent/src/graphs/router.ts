import { StateGraph, START, END } from '@langchain/langgraph';
import { classifyIntentNode, validateIntentNode, fallbackIntentNode } from '../nodes';
import type { RouterIntentStateType } from '@robocode-packages/shared';
import { RouterIntentState } from '@robocode-packages/shared';
import { Checkpointer } from '@robocode-packages/core';

const MAX_RETRIES = 3;

// ─── Routing ──────────────────────────────────────────────────────────────────

// After validate_intent:
//   valid   → END
//   invalid + retries left → classify_intent (retry with error)
//   invalid + no retries   → fallback_intent → END
const afterValidate = (state: RouterIntentStateType): string => {
  if (state.intent) return END;
  if (state.retryCount >= MAX_RETRIES) return 'fallback_intent';
  return 'classify_intent';
};

// ─── Graph ────────────────────────────────────────────────────────────────────

export function createIntentGraph() {
  const checkpointer = Checkpointer.getInstance();
  const graph = new StateGraph(RouterIntentState)
    .addNode('classify_intent', classifyIntentNode)
    .addNode('validate_intent', validateIntentNode)
    .addNode('fallback_intent', fallbackIntentNode)

    .addEdge(START, 'classify_intent')
    .addEdge('classify_intent', 'validate_intent')
    .addConditionalEdges('validate_intent', afterValidate, {
      [END]: END,
      classify_intent: 'classify_intent',
      fallback_intent: 'fallback_intent',
    })
    .addEdge('fallback_intent', END);

  return graph.compile({ checkpointer });
}

export const routerGraph = createIntentGraph();
