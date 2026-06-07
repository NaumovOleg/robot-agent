import { getToolLabel, getToolVerb, getResultPreview, buildActivitySummary, buildActivityFileRef } from '../../apps/cli/src/utils/toolVerbs';
import type { ToolActivity } from '../../apps/cli/src/types/chat';

describe('getToolLabel', () => {
  it('returns command for bash', () => {
    expect(getToolLabel('bash', { command: 'git status' })).toBe('git status');
  });
  it('returns path for read_file', () => {
    expect(getToolLabel('read_file', { path: 'src/foo.ts' })).toBe('src/foo.ts');
  });
  it('returns empty string when no path', () => {
    expect(getToolLabel('ast_analyzer', {})).toBe('');
  });
  it('truncates bash command at 60 chars', () => {
    const long = 'a'.repeat(80);
    expect(getToolLabel('bash', { command: long })).toHaveLength(60);
  });
});

describe('getToolVerb', () => {
  it('maps known tools to verbs', () => {
    expect(getToolVerb('read_file')).toBe('Reading');
    expect(getToolVerb('bash')).toBe('Running');
    expect(getToolVerb('str_replace_editor')).toBe('Editing');
    expect(getToolVerb('write_file')).toBe('Writing');
    expect(getToolVerb('grep')).toBe('Searching');
  });
  it('returns the raw name for unknown tools', () => {
    expect(getToolVerb('some_unknown_tool')).toBe('some_unknown_tool');
  });
});

describe('getResultPreview', () => {
  it('returns error first line when error is present', () => {
    expect(getResultPreview('bash', 'output', 'Error: something\ndetails')).toBe('Error: something');
  });
  it('returns null when no output and no error', () => {
    expect(getResultPreview('read_file', undefined, undefined)).toBeNull();
  });
  it('returns null for empty output', () => {
    expect(getResultPreview('bash', '', undefined)).toBeNull();
  });
  it('counts grep matches', () => {
    expect(getResultPreview('grep', 'line1\nline2\nline3', undefined)).toBe('3 matches');
  });
  it('uses singular for 1 grep match', () => {
    expect(getResultPreview('grep', 'line1', undefined)).toBe('1 match');
  });
  it('returns "no matches" for empty grep output', () => {
    expect(getResultPreview('grep', '   \n  ', undefined)).toBe('no matches');
  });
  it('counts glob files', () => {
    expect(getResultPreview('glob', 'a.ts\nb.ts', undefined)).toBe('2 files');
  });
  it('counts list_dir items', () => {
    expect(getResultPreview('list_dir', 'a\nb\nc', undefined)).toBe('3 items');
  });
  it('returns line count for read_file', () => {
    expect(getResultPreview('read_file', 'line1\nline2', undefined)).toBe('2 lines');
  });
  it('returns first line of bash output', () => {
    expect(getResultPreview('bash', 'success\nmore output', undefined)).toBe('success');
  });
  it('truncates long previews to 60 chars', () => {
    const long = 'a'.repeat(80);
    const result = getResultPreview('bash', long, undefined);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(60);
  });
});

const makeA = (
  name: string,
  status: ToolActivity['status'] = 'running',
  extra: Partial<ToolActivity> = {}
): ToolActivity => ({
  id: `${name}-${Math.random()}`,
  name,
  input: { path: `src/${name}.ts` },
  status,
  startedAt: Date.now(),
  ...extra,
});

describe('buildActivitySummary', () => {
  it('returns empty string when activities array is empty', () => {
    expect(buildActivitySummary([])).toBe('');
  });

  it('returns empty string when all activities are done (not running)', () => {
    expect(buildActivitySummary([makeA('read_file', 'done')])).toBe('');
  });

  it('returns empty string when all running tools are unknown', () => {
    expect(buildActivitySummary([makeA('totally_unknown')])).toBe('');
  });

  it('builds "Reading 1 file…" for a single read_file', () => {
    expect(buildActivitySummary([makeA('read_file')])).toBe('Reading 1 file…');
  });

  it('builds "Reading 2 files…" for two read-type tools', () => {
    expect(buildActivitySummary([makeA('read_file'), makeA('find_definition')])).toBe('Reading 2 files…');
  });

  it('builds "Searching for 2 patterns…" for grep + search_files', () => {
    expect(buildActivitySummary([makeA('grep'), makeA('search_files')])).toBe('Searching for 2 patterns…');
  });

  it('capitalises the first group verb and lowercases subsequent verbs', () => {
    const result = buildActivitySummary([makeA('grep'), makeA('read_file'), makeA('bash')]);
    expect(result).toBe('Searching for 1 pattern, reading 1 file, running 1 command…');
  });

  it('ignores done activities in the summary', () => {
    const result = buildActivitySummary([makeA('grep'), makeA('read_file', 'done')]);
    expect(result).toBe('Searching for 1 pattern…');
  });

  it('returns empty string when all activities have errored', () => {
    expect(buildActivitySummary([makeA('bash', 'error')])).toBe('');
  });

  it('uses singular units when count is 1', () => {
    expect(buildActivitySummary([makeA('bash')])).toBe('Running 1 command…');
  });

  it('uses plural units when count is greater than 1', () => {
    const a1 = makeA('bash');
    const a2: ToolActivity = { ...a1, id: 'bash-2' };
    expect(buildActivitySummary([a1, a2])).toBe('Running 2 commands…');
  });
});

describe('buildActivityFileRef', () => {
  it('returns null when activities array is empty', () => {
    expect(buildActivityFileRef([])).toBeNull();
  });

  it('returns null when all activities are done', () => {
    expect(buildActivityFileRef([makeA('read_file', 'done')])).toBeNull();
  });

  it('returns the label of the most recently started running activity', () => {
    const older = makeA('grep', 'running', { startedAt: 1000, input: { path: 'old.ts' } });
    const newer = makeA('read_file', 'running', { startedAt: 2000, input: { path: 'new.ts' } });
    expect(buildActivityFileRef([older, newer])).toBe('new.ts');
  });

  it('returns null when the most recent running activity has no label', () => {
    const a = makeA('ast_analyzer', 'running', { input: {} });
    expect(buildActivityFileRef([a])).toBeNull();
  });

  it('returns the bash command string as the label', () => {
    const a = makeA('bash', 'running', { input: { command: 'git status' } });
    expect(buildActivityFileRef([a])).toBe('git status');
  });

  it('returns null for errored activities', () => {
    expect(buildActivityFileRef([makeA('read_file', 'error')])).toBeNull();
  });
});
