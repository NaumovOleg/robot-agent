import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '@robocode-packages/shared';
import { plannerGraph } from '../../graphs/planner';

// Presents every clarifying question to the user in one prompt (numbered) so they
// can answer all at once, instead of surfacing only the first.
export const combineClarifyingQuestions = (questions: string[]): string =>
  questions.length === 1
    ? questions[0]
    : 'I need a bit more detail before planning. Please answer each:\n' +
      questions.map((q, i) => `${i + 1}. ${q}`).join('\n');

export const plannerNode = async (state: RootStateType) => {
  const { context, router, sessionId, answer, plan: prevPlan } = state;
  if (!router.intent) return {};

  // resolvedRequest is the single canonical request; plannerGraph expects string[].
  const requests = [router.intent.resolvedRequest];

  // If we already asked clarifying questions and the user answered, feed the full
  // Q&A back into this re-plan so the planner uses the answers instead of asking
  // again. (afterAsk routes planner→planner directly, bypassing preRoute, so the
  // answer is not appended elsewhere.)
  const priorQuestions = prevPlan?.clarifying_questions ?? [];
  const alreadyClarified = Boolean(answer && priorQuestions.length > 0);
  if (alreadyClarified) {
    requests.push(
      'The following clarifying questions were already asked and answered by the user. ' +
        'Use these answers and do NOT ask further clarifying questions.\n' +
        priorQuestions.map((q, i) => `Q${i + 1}: ${q}`).join('\n') +
        `\n\nUser's answers:\n${answer}`
    );
  }

  debug('[plannerNode] invoking plannerGraph with', requests.length, 'request block(s)');

  const result = await plannerGraph.invoke({
    requests,
    context,
    intent: router.intent,
    selectedFiles: state.selectedFiles ?? [],
    sessionId,
  });

  const plan = result.plan;
  if (!plan) return {};

  // Ask clarifying questions only on the FIRST pass. Present ALL of them at once
  // as a numbered list so the user can answer everything in one response. After
  // one round we proceed regardless to avoid an ask/re-ask loop.
  const questions = plan.clarifying_questions ?? [];
  if (!alreadyClarified && questions.length > 0) {
    debug('[plannerNode] asking', questions.length, 'clarifying question(s)');
    return {
      plan,
      clarificationSource: 'planner',
      question: combineClarifyingQuestions(questions),
      answer: null,
    };
  }

  debug('[plannerNode] plan resolved', alreadyClarified ? '(after clarification)' : '');
  return { plan, clarificationSource: null, question: null, answer: null };
};
