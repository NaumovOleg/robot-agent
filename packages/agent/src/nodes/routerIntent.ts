import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { RouterIntentStateType } from '@robocode-packages/shared';
import { debug, IntentRouterSchema } from '@robocode-packages/shared';
import { getModel } from '../utils';
import { buildRouterIntentPrompt } from '../prompts';

export const classifyIntentNode = async (state: RouterIntentStateType) => {
  const { requests, context, validationError, retryCount } = state;

  const systemPrompt = buildRouterIntentPrompt(context);

  const userContent = [
    requests.join('\n---\n'),
    validationError ? `\nFix validation errors:\n${validationError}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const model = getModel(false).withStructuredOutput(IntentRouterSchema, { name: 'intent_router' });

  try {
    const rawIntent = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userContent),
    ]);

    return { rawIntent, validationError: null, retryCount: retryCount + 1 };
  } catch (err) {
    debug('[classifyIntentNode] LLM call failed', err);
    return {
      rawIntent: null,
      validationError: String(err).slice(0, 600),
      retryCount: retryCount + 1,
    };
  }
};

// ─── validate_intent ──────────────────────────────────────────────────────────
// Runs Zod parse on rawIntent.
// On success → writes to intent (final output).
// On failure → writes validationError so classify_intent retries.

export const validateIntentNode = (state: RouterIntentStateType) => {
  const { rawIntent } = state;

  if (!rawIntent) {
    return {
      intent: null,
      validationError: 'LLM returned no output.',
    };
  }

  const result = IntentRouterSchema.safeParse(rawIntent);

  if (result.success) {
    return { intent: result.data, validationError: null };
  }

  const errorMessage = result.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('\n');

  return { intent: null, validationError: errorMessage };
};

// ─── fallback_intent ──────────────────────────────────────────────────────────
// Called when retryCount >= MAX_RETRIES and intent is still null.
// Produces a safe fallback that asks the user to clarify.

export const fallbackIntentNode = (state: RouterIntentStateType) => {
  debug('[fallbackIntentNode] producing fallback after', state.retryCount, 'retries');

  const keywords = state.requests
    .map((req) => {
      return req
        .split(/\s+/)
        .filter((w) => w.length > 3 && !/^(the|and|for|with|this|that|from|into)$/i.test(w))
        .slice(0, 8);
    })
    .flat();

  const fallback = IntentRouterSchema.parse({
    schemaVersion: 'intent.router.v4',
    intent: 'unknown',
    confidence: 0,
    reasoning: `Intent classification failed after ${state.retryCount} attempts.`,
    pipeline: 'full',
    shouldSearchCodebase: true,
    keywords,
    explicitFiles: [],
    scope: 'unknown',
    estimatedRisk: 'medium',
    commandIntent: null,
    needsClarification: true,
    question: 'Could you rephrase or give more detail about what you want to change?',
  });

  return { intent: fallback, validationError: null };
};
