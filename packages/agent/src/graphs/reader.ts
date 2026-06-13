import { StateGraph, END, START } from '@langchain/langgraph';
import { toolsNode, agentNode, finalReadNode, router } from '../nodes/sub/reader';

import { ReaderState } from '@robocode-packages/shared';

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
