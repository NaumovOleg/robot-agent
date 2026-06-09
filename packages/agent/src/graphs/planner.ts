import { StateGraph, START, END } from '@langchain/langgraph';
import { PlannerState, type PlannerStateType } from '@robocode-packages/shared';
import { classifyPlanNode, validatePlanNode, fallbackPlanNode } from '../nodes';

const MAX_RETRIES = 3;

// ─── Routing ──────────────────────────────────────────────────────────────────

// After validatePlanNode:
//   valid   → END
//   invalid + retries left → classifyPlanNode (retry with error)
//   invalid + no retries   → fallbackPlanNode → END
const afterValidate = (state: PlannerStateType): string => {
  if (state.plan) return END;
  if (state.retryCount >= MAX_RETRIES) return 'fallback_plan';
  return 'classify_plan';
};

// ─── Graph ────────────────────────────────────────────────────────────────────

export function createPlannerGraph() {
  const graph = new StateGraph(PlannerState)
    .addNode('classify_plan', classifyPlanNode)
    .addNode('validate_plan', validatePlanNode)
    .addNode('fallback_plan', fallbackPlanNode)

    .addEdge(START, 'classify_plan')
    .addEdge('classify_plan', 'validate_plan')
    .addConditionalEdges('validate_plan', afterValidate, {
      [END]: END,
      classify_plan: 'classify_plan',
      fallback_plan: 'fallback_plan',
    })
    .addEdge('fallback_plan', END);

  return graph.compile();
}

export const plannerGraph = createPlannerGraph();
