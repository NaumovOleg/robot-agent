import { StateGraph, END, START, MemorySaver } from '@langchain/langgraph';
import { AgentState } from '../state';
import { plannerNode, agentNode, toolApprovalNode, toolsNode, planApprovalNode } from '../nodes';
import { shouldContinue, afterToolApproval, afterPlanApproval } from '../utils';

export const buildGraph = () => {
  const checkpointer = new MemorySaver();

  const graph = new StateGraph(AgentState)
    .addNode('planner', plannerNode)
    .addNode('plan_approval', planApprovalNode)
    .addNode('agent', agentNode)
    .addNode('tool_approval', toolApprovalNode)
    .addNode('tools', toolsNode)
    .addEdge(START, 'planner')
    .addConditionalEdges('planner', afterPlanApproval, {
      plan_approval: 'plan_approval',
      agent: 'agent',
    })
    .addEdge('plan_approval', 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      tool_approval: 'tool_approval',
      __end__: END,
    })
    .addConditionalEdges('tool_approval', afterToolApproval, {
      tools: 'tools',
      agent: 'agent',
    })
    .addEdge('tools', 'agent');

  return graph.compile({ checkpointer });
};

export const agent = buildGraph();
