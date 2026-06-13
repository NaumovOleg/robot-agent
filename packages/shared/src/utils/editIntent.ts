import type { EditIntent, ReaderOutput } from '../types';

type ReaderOutputFileEvidenceKind =
  | 'finding'
  | 'function'
  | 'class'
  | 'import'
  | 'reference'
  | 'operation'
  | 'analyzed';

interface ReaderOutputFileEvidence {
  file: string;
  lines?: string;
  snippet: string;
  reason: string;
  kind: ReaderOutputFileEvidenceKind;
  name?: string;
  nodeType?: string | null;
  parentNodeType?: string | null;
  source?: string;
  specifiers?: string[];
  isDefault?: boolean;
}

const EVIDENCE_PRIORITY: Record<ReaderOutputFileEvidenceKind, number> = {
  operation: 0,
  finding: 1,
  function: 2,
  class: 3,
  import: 4,
  reference: 5,
  analyzed: 6,
};

const MAX_SNIPPET_LINES = 3;
const MAX_SNIPPET_CHARS = 320;

const cleanText = (value?: string | null): string => {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
};

const compactWhitespace = (value?: string | null): string => {
  return cleanText(value)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
};

const clipSnippet = (value?: string | null): string => {
  const text = cleanText(value);
  if (!text) return '';

  const lines = text.split('\n').map((line) => line.trimEnd());
  let clipped = lines.slice(0, MAX_SNIPPET_LINES).join('\n').trim();

  if (lines.length > MAX_SNIPPET_LINES) {
    clipped = `${clipped}\n...`;
  }

  if (clipped.length > MAX_SNIPPET_CHARS) {
    clipped = `${clipped.slice(0, MAX_SNIPPET_CHARS - 3).trimEnd()}...`;
  }

  return clipped;
};

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const normalizeLines = (value?: string | null): string | undefined => {
  const text = cleanText(value);
  return text || undefined;
};

const parseLocation = (location?: string | null): { file: string; lines?: string } => {
  const raw = cleanText(location);
  if (!raw) return { file: '' };

  const match = raw.match(/^(.*?)(?::(\d+)(?:-(\d+))?(?::\d+)?)?$/);
  if (!match) return { file: raw };

  const file = cleanText(match[1]);
  const start = match[2];
  const end = match[3];

  if (!start) return { file: file || raw };

  return {
    file: file || raw,
    lines: end ? `${start}-${end}` : start,
  };
};

const buildEvidenceIndex = (output: ReaderOutput): Map<string, ReaderOutputFileEvidence[]> => {
  const index = new Map<string, ReaderOutputFileEvidence[]>();

  const push = (evidence: ReaderOutputFileEvidence) => {
    if (!evidence.file) return;
    const existing = index.get(evidence.file) ?? [];
    existing.push(evidence);
    index.set(evidence.file, existing);
  };

  for (const hint of output.potential_edit_strategy?.operation_hints ?? []) {
    push({
      file: cleanText(hint.file),
      lines: normalizeLines(hint.lines),
      snippet: clipSnippet(hint.anchor ?? hint.details) || cleanText(hint.details),
      reason: compactWhitespace(hint.details),
      kind: 'operation',
      name: hint.symbol ?? undefined,
      nodeType: hint.nodeType ?? undefined,
    });
  }

  for (const finding of output.key_findings) {
    push({
      file: cleanText(finding.file),
      lines: normalizeLines(finding.lines),
      snippet: clipSnippet(finding.content) || cleanText(finding.content),
      reason: compactWhitespace(finding.comment) || compactWhitespace(output.summary),
      kind: 'finding',
    });
  }

  for (const fn of output.functions) {
    const location = parseLocation(fn.location);
    push({
      file: cleanText(location.file),
      lines: location.lines,
      snippet: clipSnippet(fn.bodyPreview ?? fn.signature) || cleanText(fn.signature),
      reason: compactWhitespace(`Function ${fn.name} was inspected and is relevant to the change.`),
      kind: 'function',
      name: fn.name,
      nodeType: fn.nodeType ?? undefined,
      parentNodeType: fn.parentNodeType ?? undefined,
    });
  }

  for (const cls of output.classes) {
    const location = parseLocation(cls.location);
    push({
      file: cleanText(location.file),
      lines: location.lines,
      snippet: clipSnippet(
        `class ${cls.name}\nmethods: ${cls.methods.join(', ')}\nproperties: ${cls.properties.join(', ')}`
      ),
      reason: compactWhitespace(`Class ${cls.name} was inspected and is relevant to the change.`),
      kind: 'class',
      name: cls.name,
      nodeType: 'class_declaration',
    });
  }

  for (const imp of output.imports) {
    const location = parseLocation(imp.location);
    push({
      file: cleanText(location.file),
      lines: location.lines,
      snippet: clipSnippet(
        `${imp.isDefault ? 'default import' : 'named import'} from ${imp.source}: ${imp.specifiers.join(', ')}`
      ),
      reason: compactWhitespace(`Import from ${imp.source} was inspected and may need adjustment.`),
      kind: 'import',
      source: imp.source,
      specifiers: imp.specifiers,
      isDefault: imp.isDefault,
      nodeType: 'import_statement',
    });
  }

  for (const reference of output.references) {
    for (const usage of reference.usages) {
      push({
        file: cleanText(usage.file),
        lines: String(usage.line),
        snippet: clipSnippet(usage.context),
        reason: compactWhitespace(`Symbol ${reference.symbol} is referenced here.`),
        kind: 'reference',
        name: reference.symbol,
        nodeType: 'identifier',
      });
    }
  }

  return index;
};

const pickBestEvidence = (
  file: string,
  index: Map<string, ReaderOutputFileEvidence[]>,
  fallbackReason: string,
  fallbackSnippet: string
): { evidence: ReaderOutputFileEvidence; hasFallback: boolean } => {
  const entries = index.get(file);
  if (!entries || entries.length === 0) {
    return {
      evidence: { file, reason: fallbackReason, snippet: fallbackSnippet, kind: 'analyzed' },
      hasFallback: true,
    };
  }

  const best = entries.reduce((prev, curr) =>
    EVIDENCE_PRIORITY[curr.kind] < EVIDENCE_PRIORITY[prev.kind] ? curr : prev
  );

  return { evidence: best, hasFallback: false };
};

const getTargetFiles = (output: ReaderOutput): string[] => {
  const strategyFiles = (output.potential_edit_strategy?.files_to_modify ?? []) as string[];
  if (strategyFiles.length > 0) {
    return unique(strategyFiles.map(cleanText).filter(Boolean)).sort();
  }

  const fromFindings = output.key_findings
    .map((finding: any) => cleanText(finding.file))
    .filter(Boolean);
  const fromFunctions = output.functions
    .map((fn: any) => parseLocation(fn.location).file)
    .filter(Boolean);
  const fromClasses = output.classes
    .map((cls: any) => parseLocation(cls.location).file)
    .filter(Boolean);
  const fromImports = output.imports
    .map((imp: any) => parseLocation(imp.location).file)
    .filter(Boolean);
  const fromReferences = output.references.flatMap((reference: any) =>
    reference.usages.map((usage: any) => cleanText(usage.file)).filter(Boolean)
  );

  return unique([
    ...fromFindings,
    ...fromFunctions,
    ...fromClasses,
    ...fromImports,
    ...fromReferences,
  ]).sort();
};

const buildTargetFiles = (
  output: ReaderOutput,
  evidenceIndex: Map<string, ReaderOutputFileEvidence[]>
) => {
  const fallbackReason =
    compactWhitespace(output.summary) || 'Reader identified this file as relevant.';
  const fallbackSnippet = '(no specific evidence snippet available for this file)';

  return getTargetFiles(output).map((file) => {
    const { evidence, hasFallback } = pickBestEvidence(
      file,
      evidenceIndex,
      fallbackReason,
      fallbackSnippet
    );

    return {
      file,
      lines: evidence.lines,
      reason: evidence.reason || fallbackReason,
      snippet: evidence.snippet || fallbackSnippet,
      hasFallback,
    };
  });
};

const buildVerification = (output: ReaderOutput): string[] => {
  const lang = output.language?.toLowerCase() ?? '';

  let testStep: string;
  if (lang === 'typescript' || lang === 'tsx' || lang === 'ts') {
    testStep = 'Run the TypeScript type check (tsc --noEmit) for the touched files.';
  } else if (lang === 'javascript' || lang === 'js' || lang === 'jsx') {
    testStep = 'Run the relevant test suite or linting for the touched files.';
  } else if (lang === 'python') {
    testStep = 'Run the relevant pytest suite or mypy type checks for the touched files.';
  } else if (lang === 'go') {
    testStep = 'Run go build and go test ./... for the touched packages.';
  } else if (lang === 'rust') {
    testStep = 'Run cargo check and cargo test for the touched crates.';
  } else {
    testStep = 'Run the smallest relevant test or validation command for the touched files.';
  }

  const steps = [testStep, 'Inspect the resulting diff for unintended changes.'];

  const filesToModify = output.potential_edit_strategy?.files_to_modify ?? [];
  if (filesToModify.length > 0) {
    const fileList =
      filesToModify.length <= 8
        ? filesToModify.join(', ')
        : `${filesToModify.slice(0, 8).join(', ')} and ${filesToModify.length - 8} more`;
    steps.unshift(`Review the proposed changes for: ${fileList}.`);
  }

  return unique(steps);
};

const buildConstraints = (output: ReaderOutput): string[] => {
  const strategyConstraints = output.potential_edit_strategy?.constraints ?? [];
  return unique(strategyConstraints.map(compactWhitespace).filter(Boolean));
};

const buildGoal = (output: ReaderOutput): string => {
  const strategyGoal = compactWhitespace(output.potential_edit_strategy?.goal);
  if (strategyGoal) return strategyGoal;

  const findingGoal = compactWhitespace(output.key_findings[0]?.comment);
  if (findingGoal) return findingGoal;

  return (
    compactWhitespace(output.summary) ||
    'Review the inspected code and prepare a focused edit plan.'
  );
};

const buildSummary = (output: ReaderOutput): string => {
  const summary = compactWhitespace(output.summary);
  if (summary) return summary;

  const goal = compactWhitespace(output.potential_edit_strategy?.goal);
  if (goal) return goal;

  return 'Reader analysis completed without a concrete edit strategy.';
};

export const buildEditIntent = (output: ReaderOutput): Omit<EditIntent, 'edits' | 'confidence'> => {
  const evidenceIndex = buildEvidenceIndex(output);
  const targetFiles = buildTargetFiles(output, evidenceIndex);
  return {
    goal: buildGoal(output),
    summary: buildSummary(output),
    targetFiles,
    constraints: buildConstraints(output),
    verification: buildVerification(output),
  };
};
