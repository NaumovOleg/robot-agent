import { StateGraph, END, START } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import {
  initNode,
  stepSelectorNode,
  readerStepNode,
  miniReaderNode,
  approvalGateNode,
  applyNode,
  verifyStepNode,
  stepReviewNode,
  escalateNode,
  finalizeNode,
  hasDestructiveHints,
} from '../../nodes/sub/executor';
import { ExecutorState } from './state';
import type { ExecutorStateType } from './state';

const afterInit = (state: ExecutorStateType): string =>
  state.lastError ? 'finalize' : 'step_selector';

const afterSelector = (state: ExecutorStateType): string => {
  if (!state.currentStepId) return 'finalize';
  const step = state.plan?.steps.find((s) => s.id === state.currentStepId);
  return step?.kind === 'inspect' ? 'reader_step' : 'mini_reader';
};

const afterReaderStep = (state: ExecutorStateType): string =>
  state.currentStepId && state.stepStates[state.currentStepId] === 'failed'
    ? 'escalate'
    : 'step_selector';

const afterMiniReader = (state: ExecutorStateType): string => {
  if (state.currentHints.length === 0) return 'step_review'; // failure path
  return hasDestructiveHints(state) ? 'approval_gate' : 'apply';
};

const afterApprovalGate = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'apply';

const afterApply = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'verify_step';

const afterReview = (state: ExecutorStateType): string => {
  if (!state.currentStepId) return 'step_selector'; // done
  if (state.stepStates[state.currentStepId] === 'failed') return 'escalate';
  if (!state.lastError) return 'step_selector'; // no retry reason — avoid ghost retry loop
  return 'mini_reader'; // retry
};

const afterEscalate = (state: ExecutorStateType): string => {
  if (state.escalationDecision === 'abort') return 'finalize';
  if (state.escalationDecision === 'skip') return 'step_selector';
  const step = state.plan?.steps.find((s) => s.id === state.currentStepId);
  return step?.kind === 'inspect' ? 'reader_step' : 'mini_reader';
};

// `checkpointer` is only for isolated testing of interrupt/resume. In production
// the executor runs as a subgraph-node with no checkpointer of its own and
// inherits the root graph's checkpointer (which is what propagates interrupts to
// the root thread). Passing one here would give it a separate persistence scope.
export function createExecutorGraph(checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(ExecutorState)
    .addNode('init', initNode)
    .addNode('step_selector', stepSelectorNode)
    .addNode('reader_step', readerStepNode)
    .addNode('mini_reader', miniReaderNode)
    .addNode('approval_gate', approvalGateNode)
    .addNode('apply', applyNode)
    .addNode('verify_step', verifyStepNode)
    .addNode('step_review', stepReviewNode)
    .addNode('escalate', escalateNode)
    .addNode('finalize', finalizeNode)

    .addEdge(START, 'init')
    .addConditionalEdges('init', afterInit, {
      step_selector: 'step_selector', finalize: 'finalize',
    })
    .addConditionalEdges('step_selector', afterSelector, {
      reader_step: 'reader_step', mini_reader: 'mini_reader', finalize: 'finalize',
    })
    .addConditionalEdges('reader_step', afterReaderStep, {
      escalate: 'escalate', step_selector: 'step_selector',
    })
    .addConditionalEdges('mini_reader', afterMiniReader, {
      approval_gate: 'approval_gate', apply: 'apply', step_review: 'step_review',
    })
    .addConditionalEdges('approval_gate', afterApprovalGate, {
      step_review: 'step_review', apply: 'apply',
    })
    .addConditionalEdges('apply', afterApply, {
      step_review: 'step_review', verify_step: 'verify_step',
    })
    .addEdge('verify_step', 'step_review')
    .addConditionalEdges('step_review', afterReview, {
      step_selector: 'step_selector', escalate: 'escalate', mini_reader: 'mini_reader',
    })
    .addConditionalEdges('escalate', afterEscalate, {
      finalize: 'finalize', step_selector: 'step_selector',
      reader_step: 'reader_step', mini_reader: 'mini_reader',
    })
    .addEdge('finalize', END);

  // NOTE: when invoked from the root graph, pass recursionLimit >= 75 — a multi-step plan with retries exceeds LangGraph's default of 25.
  return graph.compile(checkpointer ? { checkpointer } : undefined);
}

export const executorGraph = createExecutorGraph();
