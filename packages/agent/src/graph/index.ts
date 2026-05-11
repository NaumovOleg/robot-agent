import { StateGraph, END, START, MemorySaver } from '@langchain/langgraph';

import { AgentState } from '../state';
import { plannerNode, agentNode, toolApprovalNode, toolsNode } from '@nodes';
import { shouldContinue, afterApproval } from '@utils';

export const buildGraph = () => {
  const checkpointer = new MemorySaver();

  const graph = new StateGraph(AgentState)
    .addNode('planner', plannerNode)
    .addNode('agent', agentNode)
    .addNode('tool_approval', toolApprovalNode)
    .addNode('tools', toolsNode)
    .addEdge(START, 'planner')
    .addEdge('planner', 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      tool_approval: 'tool_approval',
      __end__: END,
    })
    .addConditionalEdges('tool_approval', afterApproval, {
      tools: 'tools',
      agent: 'agent',
    })
    .addEdge('tools', 'agent');

  return graph.compile({ checkpointer });
};

export const agent = buildGraph();
