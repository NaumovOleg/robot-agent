import type { ReaderStateType } from '../../../subagents/reader';
import type { ReaderOutput } from '@robocode-packages/shared';
import { debug, ReaderOutputSchema, isAIMessage } from '@robocode-packages/shared';
import { SystemMessage } from '@langchain/core/messages';
import { createBaseModel } from '../../../utils';
import { READER_FINALIZER_PROMPT } from '../../../prompts';

type MaybeRecord = Record<string, unknown>;

function extractFileFromLocation(location: unknown): string {
  if (typeof location !== 'string') return '';
  return location.split(':')[0]?.trim() ?? '';
}

function parseJsonRecord(value: unknown): MaybeRecord | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as MaybeRecord;
  } catch {
    return null;
  }
}

function sanitizeReaderOutputCandidate(candidate: MaybeRecord): MaybeRecord {
  const filesAnalyzed = Array.isArray(candidate.filesAnalyzed) ? candidate.filesAnalyzed : [];
  const analyzedSet = new Set(
    filesAnalyzed.filter((f): f is string => typeof f === 'string' && f.length > 0)
  );

  const sanitizeByLocation = (items: unknown): unknown[] => {
    if (!Array.isArray(items)) return [];
    return items.filter((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const location = (item as MaybeRecord).location;
      if (location == null || location === '') return true;
      const file = extractFileFromLocation(location);
      return !!file && analyzedSet.has(file);
    });
  };

  const sanitizeReferences = (refs: unknown): unknown[] => {
    if (!Array.isArray(refs)) return [];
    return refs
      .filter((ref) => ref && typeof ref === 'object' && !Array.isArray(ref))
      .map((ref) => {
        const usageList = Array.isArray((ref as MaybeRecord).usages)
          ? ((ref as MaybeRecord).usages as unknown[])
          : [];
        const usages = usageList.filter((usage) => {
          if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return false;
          const file = (usage as MaybeRecord).file;
          return typeof file === 'string' && analyzedSet.has(file);
        });
        return {
          ...(ref as MaybeRecord),
          usages,
        };
      });
  };

  const sanitizeFindings = (findings: unknown): unknown[] => {
    if (!Array.isArray(findings)) return [];
    return findings.filter((finding) => {
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return false;
      const file = (finding as MaybeRecord).file;
      return typeof file === 'string' && analyzedSet.has(file);
    });
  };

  const sanitized: MaybeRecord = {
    ...candidate,
    functions: sanitizeByLocation(candidate.functions),
    classes: sanitizeByLocation(candidate.classes),
    imports: sanitizeByLocation(candidate.imports),
    references: sanitizeReferences(candidate.references),
    key_findings: sanitizeFindings(candidate.key_findings),
  };

  const strategyRaw = sanitized.potential_edit_strategy;
  if (!strategyRaw || typeof strategyRaw !== 'object' || Array.isArray(strategyRaw)) {
    return sanitized;
  }

  const strategy = strategyRaw as MaybeRecord;
  const filesToModify = Array.isArray(strategy.files_to_modify)
    ? strategy.files_to_modify.filter(
        (file): file is string => typeof file === 'string' && file.length > 0
      )
    : [];
  const modifySet = new Set(filesToModify);

  const operationHints = Array.isArray(strategy.operation_hints)
    ? strategy.operation_hints.filter((hint) => {
        if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return false;
        const hintRecord = hint as MaybeRecord;
        const op = hintRecord.op;
        const file = hintRecord.file;
        if (typeof op !== 'string' || typeof file !== 'string') return false;
        if (op === 'create_file') return true;
        return analyzedSet.has(file) && modifySet.has(file);
      })
    : [];

  return {
    ...sanitized,
    potential_edit_strategy: {
      ...strategy,
      files_to_modify: filesToModify,
      operation_hints: operationHints,
    },
  };
}

function tryRecoverReaderOutput(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const llmOutput = (error as { llmOutput?: unknown }).llmOutput;
  const parsed = parseJsonRecord(llmOutput);
  if (!parsed) return null;

  const sanitized = sanitizeReaderOutputCandidate(parsed);
  const validated = ReaderOutputSchema.safeParse(sanitized);
  if (!validated.success) return null;
  return validated.data;
}

// Last-resort recovery: build a minimal, schema-valid `insufficient` output from
// whatever the LLM produced (its summary + analyzed files) so a parse failure
// degrades the inspect step to a thin-but-usable digest instead of hard-failing
// it into escalation. The mini-reader re-reads the files fresh anyway.
function synthesizeMinimalOutput(error: unknown, state: ReaderStateType): ReaderOutput {
  const llmOutput = (error as { llmOutput?: unknown })?.llmOutput;
  const raw = parseJsonRecord(llmOutput);

  const rawSummary = raw && typeof raw.summary === 'string' ? raw.summary.trim() : '';
  const focus = state.focus ?? [];
  const summary =
    rawSummary ||
    `Partial inspection of ${focus.join(', ') || state.task || 'the target files'}; ` +
      `the structured reader output could not be fully parsed.`;

  const filesAnalyzed =
    raw && Array.isArray(raw.filesAnalyzed)
      ? raw.filesAnalyzed.filter((f): f is string => typeof f === 'string' && f.length > 0)
      : focus;

  const candidate = {
    schemaVersion: 'reader.output.v2' as const,
    status: 'insufficient' as const,
    summary,
    filesAnalyzed,
    unresolvedQuestions: [
      'Reader output could not be fully parsed; proceeding with partial context.',
    ],
    potential_edit_strategy: null,
  };

  const validated = ReaderOutputSchema.safeParse(candidate);
  if (validated.success) return validated.data;
  // Schema somehow still rejects (e.g. odd file paths) — return a bare object that
  // satisfies the type. readerStep treats `insufficient` as a usable digest.
  return { ...candidate, filesAnalyzed: [] } as unknown as ReaderOutput;
}

export async function finalReadNode(state: ReaderStateType) {
  const llm = createBaseModel(false).withStructuredOutput(ReaderOutputSchema, {
    method: 'functionCalling',
  });
  const messages = state.messages;

  const lastMsg = messages.at(-1);
  if (lastMsg && isAIMessage(lastMsg) && lastMsg.tool_calls?.length) {
    messages.pop();
  }
  const prompt = READER_FINALIZER_PROMPT(state);
  let editIntentInputPayload;
  try {
    editIntentInputPayload = await llm.invoke([new SystemMessage(prompt), ...messages]);
  } catch (err) {
    const recovered = tryRecoverReaderOutput(err);
    if (recovered) {
      debug('[reader/final] recovered output from raw LLM JSON after parse failure');
      editIntentInputPayload = recovered;
    } else {
      // Never throw: degrade to a minimal insufficient digest so one bad field
      // doesn't fail the whole inspect step.
      editIntentInputPayload = synthesizeMinimalOutput(err, state);
      debug('[reader/final] parse failed; degraded to insufficient digest:', editIntentInputPayload.summary);
    }
  }

  return { editIntentInputPayload };
}
