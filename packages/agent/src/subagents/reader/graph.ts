import { StateGraph, END, START } from '@langchain/langgraph';
import { toolsNode, agentNode, finalReadNode } from '../../../nodes/sub/reader';
import { router } from './router';

import { ReaderState } from './state';

export function createReaderGraph() {
  const graph = new StateGraph(ReaderState)
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addNode('final', finalReadNode)
    .addEdge(START, 'agent')
    .addEdge('tools', 'agent')
    .addConditionalEdges('agent', router)
    .addEdge('final', END);

  return graph.compile();
}

export const readerGraph = createReaderGraph();
