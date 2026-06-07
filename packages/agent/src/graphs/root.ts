import { StateGraph, END, START } from '@langchain/langgraph';
import { Checkpointer } from '@robocode-packages/core';
import { RootState, debug } from '@robocode-packages/shared';
import {
  contextNode,
  rootAgentNode,
  askUserNode,
  afterAsk,
  routerIntentNode,
  preRoute,
} from '../nodes';

export function buildGraph() {
  const checkpointer = Checkpointer.getInstance();

  const graph = new StateGraph(RootState)
    .addNode('context_node', contextNode)
    .addNode('pre_route', preRoute)
    .addNode('router_intent', routerIntentNode)
    .addNode('question_node', askUserNode)
    .addNode('agent', rootAgentNode)
    .addEdge(START, 'context_node')
    .addEdge('context_node', 'pre_route')
    .addEdge('pre_route', 'router_intent')

    .addConditionalEdges(
      'router_intent',
      (state) => {
        debug('ROUTER INTENT EDGE CASE', state);
        if (state.router.intent?.needsClarification) return 'question_node';
        return 'agent';
      },
      { question_node: 'question_node', agent: 'agent' }
    )

    .addConditionalEdges('question_node', afterAsk, {
      pre_route: 'pre_route',
      agent: 'agent',
    })

    .addEdge('agent', END);

  return graph.compile({ checkpointer });
}

export const rootGraph = buildGraph();
