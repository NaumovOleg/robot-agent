import { StateGraph, END, START } from '@langchain/langgraph';
import { Checkpointer } from '@robocode-packages/core';
import type { RootStateType } from '@robocode-packages/shared';
import { RootState } from '@robocode-packages/shared';
import {
  contextNode,
  rootAgentNode,
  askUserNode,
  routerIntentNode,
  preRoute,
  afterRouterIntent,
  plannerNode,
  fileSelectorNode,
  afterAsk,
} from '../nodes';

const afterPlanner = (state: RootStateType): string => {
  if (state.clarificationSource === 'planner') return 'question_node';
  return 'agent'; // → replace with 'reader' when ready
};

export function buildGraph() {
  const checkpointer = Checkpointer.getInstance();

  const graph = new StateGraph(RootState)
    .addNode('context_node', contextNode)
    .addNode('pre_route', preRoute)
    .addNode('router_intent', routerIntentNode)
    .addNode('file_selector', fileSelectorNode)
    .addNode('planner', plannerNode)
    .addNode('question_node', askUserNode)
    .addNode('agent', rootAgentNode)
    .addEdge(START, 'context_node')
    .addEdge('context_node', 'pre_route')
    .addEdge('pre_route', 'router_intent')

    .addConditionalEdges('router_intent', afterRouterIntent, {
      question_node: 'question_node',
      file_selector: 'file_selector',
      planner: 'planner',
      agent: 'agent',
    })

    .addEdge('file_selector', 'planner')

    .addConditionalEdges('planner', afterPlanner, {
      question_node: 'question_node',
      agent: 'agent',
    })

    .addConditionalEdges('question_node', afterAsk, {
      pre_route: 'pre_route',
      planner: 'planner',
      agent: 'agent',
    })

    .addEdge('agent', END);

  return graph.compile({ checkpointer });
}

export const rootGraph = buildGraph();
