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
  validateNode,
  repairNode,
  formatNode,
} from '../../nodes/sub/executor';
import { traceExecutorNode } from '../../nodes/sub/executor/summary';
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
  if (state.miniReaderStatus === 'blocked') return 'escalate';
  if (state.miniReaderStatus === 'noop' || state.currentHints.length === 0) return 'step_review';
  return 'validate';
};

const afterValidate = (state: ExecutorStateType): string => {
  if (state.hintErrors.length === 0) {
    return hasDestructiveHints(state) ? 'approval_gate' : 'apply';
  }
  return 'repair';
};

const afterRepair = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'validate';

const afterApprovalGate = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'apply';

const afterApply = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'format';

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
    .addNode('validate', validateNode)
    .addNode('repair', repairNode)
    .addNode('format', traceExecutorNode('format', formatNode))
    .addNode('approval_gate', traceExecutorNode('approval_gate', approvalGateNode))
    .addNode('apply', traceExecutorNode('apply', applyNode))
    .addNode('verify_step', traceExecutorNode('verify_step', verifyStepNode))
    .addNode('step_review', traceExecutorNode('step_review', stepReviewNode))
    .addNode('escalate', traceExecutorNode('escalate', escalateNode))
    .addNode('finalize', traceExecutorNode('finalize', finalizeNode))

    .addEdge(START, 'init')
    .addConditionalEdges('init', afterInit, {
      step_selector: 'step_selector',
      finalize: 'finalize',
    })
    .addConditionalEdges('step_selector', afterSelector, {
      reader_step: 'reader_step',
      mini_reader: 'mini_reader',
      finalize: 'finalize',
    })
    .addConditionalEdges('reader_step', afterReaderStep, {
      escalate: 'escalate',
      step_selector: 'step_selector',
    })
    .addConditionalEdges('mini_reader', afterMiniReader, {
      validate: 'validate',
      escalate: 'escalate',
      step_review: 'step_review',
    })
    .addConditionalEdges('validate', afterValidate, {
      approval_gate: 'approval_gate',
      apply: 'apply',
      repair: 'repair',
    })
    .addConditionalEdges('repair', afterRepair, {
      validate: 'validate',
      step_review: 'step_review',
    })
    .addConditionalEdges('approval_gate', afterApprovalGate, {
      step_review: 'step_review',
      apply: 'apply',
    })
    .addConditionalEdges('apply', afterApply, {
      step_review: 'step_review',
      format: 'format',
    })
    .addEdge('format', 'verify_step')
    .addEdge('verify_step', 'step_review')
    .addConditionalEdges('step_review', afterReview, {
      step_selector: 'step_selector',
      escalate: 'escalate',
      mini_reader: 'mini_reader',
    })
    .addConditionalEdges('escalate', afterEscalate, {
      finalize: 'finalize',
      step_selector: 'step_selector',
      reader_step: 'reader_step',
      mini_reader: 'mini_reader',
    })
    .addEdge('finalize', END);

  // NOTE: when invoked from the root graph, pass recursionLimit >= 75 — a multi-step plan with retries exceeds LangGraph's default of 25.
  return graph.compile(checkpointer ? { checkpointer } : undefined);
}

export const executorGraph = createExecutorGraph();

const a = async () => {
  await executorGraph.invoke({
    sessionId: '1e869409-6404-4bf8-9c30-3ab5224a44a3',
    cwd: '/Users/oleg/Documents/projects/robocode-cli/apps/cli',
    context: {
      cwd: '/Users/oleg/Documents/projects/robocode-cli/apps/cli',
      git: {
        branch: 'feat/executor-loop',
        staged: ['robocode/index.json'],
        unstaged: ['../../packages/agent/src/nodes/root/trace.ts'],
        recentCommits: [
          {
            hash: '488c694',
            message:
              'fix(executor): reset miniReaderStatus on escalate-retry + mini_reader early returns',
          },
          {
            hash: '1855ccc',
            message:
              'feat(executor): rewrite mini_reader output rules for 6 ops + status, language-neutral',
          },
          {
            hash: 'e213020',
            message: 'test(executor): migrate suite to 6-op + 3-state contract',
          },
          {
            hash: 'cfa8a97',
            message: 'feat(executor): wire validate→repair→apply→format, noop→done',
          },
          {
            hash: '86769f5',
            message: 'feat(executor): per-language formatter pass after apply',
          },
        ],
      },
      language: {
        primary: 'typescript',
        linter: 'npx eslint --max-warnings=0',
        typeCheck: 'tsc --noEmit',
        build: 'tsc --build',
        aliases: [
          {
            name: '@providers',
            path: './src/providers/index.ts',
          },
          {
            name: '@hooks',
            path: './src/hooks/index.ts',
          },
          {
            name: '@screens',
            path: './src/screens/index.ts',
          },
          {
            name: '@types',
            path: './src/types/index.ts',
          },
          {
            name: '@utils',
            path: './src/utils/index.ts',
          },
          {
            name: '@components',
            path: './src/components/index.ts',
          },
          {
            name: '@elements',
            path: './src/elements/index.ts',
          },
          {
            name: '@robocode-packages/agent',
            path: '../../packages/agent/src/index.ts',
          },
          {
            name: '@robocode-packages/config',
            path: '../../packages/config/src/index.ts',
          },
          {
            name: '@robocode-packages/core',
            path: '../../packages/core/src/index.ts',
          },
          {
            name: '@robocode-packages/providers',
            path: '../../packages/providers/src/index.ts',
          },
          {
            name: '@robocode-packages/shared',
            path: '../../packages/shared/src/index.ts',
          },
          {
            name: '@robocode-packages/tools',
            path: '../../packages/tools/src/index.ts',
          },
          {
            name: '@robocode-packages/ui',
            path: '../../packages/ui/src/index.ts',
          },
        ],
      },
      project: {
        name: 'robocode',
        frameworks: ['react', 'langchain'],
      },
      structure: [
        {
          path: '.',
          children: ['src'],
        },
        {
          path: 'src',
          children: ['components', 'elements', 'hooks', 'providers', 'screens', 'types', 'utils'],
        },
        {
          path: 'src/providers',
          children: ['profile', 'router', 'session'],
        },
        {
          path: 'src/screens',
          children: ['chat', 'faq'],
        },
      ],
      entryPoints: ['src/index.ts'],
    },
    plan: {
      goal: 'Add a new FAQScreen component under src/screens/faq and integrate it into routing logic in app.tsx for user navigation.',
      clarifying_questions: [],
      risk: 'medium',
      assumptions: [
        'App entry point responsible for routes is src/app.tsx or a similar file in src/ (likely uses React Router).',
        'FAQ screen components are located under src/screens/faq/ per codebase structure.',
        "Navigation to FAQ should appear in the main navigation/menu, and be accessible at a standard route like '/faq'.",
      ],
      constraints: [
        'Follow TypeScript type-checking: run tsc --noEmit after every file modification—fix all errors before proceeding.',
        'Do not break or remove existing routes or navigation.',
        'FAQScreen should use conventional export patterns matching other screens.',
      ],
      files_affected: ['src/screens/faq/FAQScreen.tsx', 'src/app.tsx'],
      steps: [
        {
          id: 'inspect-app-tsx',
          kind: 'inspect',
          title: 'Read src/app.tsx to understand existing route integration and navigation setup',
          files: ['src/app.tsx'],
          depends_on: [],
          expected_output:
            'The main app routing layout and navigation logic are understood, especially how new screens are added.',
        },
        {
          id: 'create-faqscreen-component',
          kind: 'create',
          title: 'Create FAQScreen component in src/screens/faq/FAQScreen.tsx',
          files: ['src/screens/faq/FAQScreen.tsx'],
          depends_on: [],
          expected_output:
            'src/screens/faq/FAQScreen.tsx defines and exports a functioning FAQScreen React component without type errors.',
        },
        {
          id: 'edit-app-tsx-for-faq-route',
          kind: 'edit',
          title: 'Edit src/app.tsx to add a route and navigation entry for FAQScreen',
          files: ['src/app.tsx'],
          depends_on: ['inspect-app-tsx', 'create-faqscreen-component'],
          expected_output:
            'FAQScreen is imported, a /faq route is added, main navigation includes a link to FAQ, and tsc --noEmit reports no errors.',
        },
      ],
      gitStep: null,
    },
    stepResults: [],
  });
};

a();
