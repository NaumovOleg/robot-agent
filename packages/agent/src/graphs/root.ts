import { StateGraph, END, START } from '@langchain/langgraph';
import { Checkpointer } from '@robocode-packages/core';
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
import { planApprovalNode } from '../nodes/root/planApproval';
import { executorReportNode } from '../nodes/root/executorReport';
import { executorGraph } from '../subagents/executor';
import { afterPlanner, afterPlanApproval } from './rootRouting';

export { afterPlanner, afterPlanApproval } from './rootRouting';

export function buildGraph() {
  const checkpointer = Checkpointer.getInstance();

  const graph = new StateGraph(RootState)
    .addNode('context_node', contextNode)
    .addNode('pre_route', preRoute)
    .addNode('router_intent', routerIntentNode)
    .addNode('file_selector', fileSelectorNode)
    .addNode('planner', plannerNode)
    .addNode('question_node', askUserNode)
    .addNode('plan_approval', planApprovalNode)
    .addNode('executor', executorGraph as never)
    .addNode('executor_report', executorReportNode)
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
      plan_approval: 'plan_approval',
      agent: 'agent',
    })

    .addConditionalEdges('plan_approval', afterPlanApproval, {
      executor: 'executor',
      agent: 'agent',
    })

    .addEdge('executor', 'executor_report')
    .addEdge('executor_report', 'agent')

    .addConditionalEdges('question_node', afterAsk, {
      pre_route: 'pre_route',
      planner: 'planner',
      agent: 'agent',
    })

    .addEdge('agent', END);

  return graph.compile({ checkpointer });
}

export const rootGraph = buildGraph();
