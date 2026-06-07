import { StateGraph, START, END } from '@langchain/langgraph';

import { extractKeywordsNode, grepNode, scoringNode, selectTopKNode } from '../nodes/fileSelector';

import { FileSelectorState } from '@robocode-packages/shared';

export function createWriterGraph() {
  const graph = new StateGraph(FileSelectorState)
    .addNode('extract_keywords', extractKeywordsNode)
    .addNode('grep', grepNode)
    .addNode('score', scoringNode)
    .addNode('select', selectTopKNode)
    .addEdge(START, 'extract_keywords')
    .addEdge('extract_keywords', 'grep')
    .addEdge('grep', 'score')
    .addEdge('score', 'select')
    .addEdge('select', END);

  return graph.compile();
}

export const fileSelectorGraph = createWriterGraph();
