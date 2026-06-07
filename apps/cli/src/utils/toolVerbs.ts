import type { ToolActivity } from '../types/chat';

export const getToolLabel = (name: string, input: unknown): string => {
  const args = (input ?? {}) as Record<string, unknown>;
  if (name === 'bash') return String(args.command ?? '').slice(0, 60);
  const path = args.path ?? args.file ?? args.target;
  if (path) return String(path);
  return '';
};

export const TOOL_VERB: Record<string, string> = {
  read_file: 'Reading',
  write_file: 'Writing',
  str_replace_editor: 'Editing',
  edit_file: 'Editing',
  patch_file: 'Patching',
  bash: 'Running',
  grep: 'Searching',
  glob: 'Searching',
  list_dir: 'Listing',
  search_files: 'Searching',
  find_definition: 'Finding',
  ast_get_symbol: 'Reading',
  ast_analyzer: 'Analyzing',
  ast_rename: 'Renaming',
  validate_project: 'Validating',
  undo: 'Undoing',
};

export const getToolVerb = (name: string): string => TOOL_VERB[name] ?? name;

const truncate = (s: string, max = 60): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const firstNonEmptyLine = (s: string): string =>
  s.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';

const countNonEmpty = (s: string): number =>
  s.split('\n').filter((l) => l.trim().length > 0).length;

export const getResultPreview = (
  name: string,
  output: string | undefined,
  error: string | undefined
): string | null => {
  if (error) return truncate(error.split('\n')[0].trim());
  if (!output) return null;

  if (name === 'bash') {
    const first = firstNonEmptyLine(output);
    return first ? truncate(first) : null;
  }
  if (name === 'grep' || name === 'search_files') {
    const n = countNonEmpty(output);
    return n > 0 ? `${n} match${n !== 1 ? 'es' : ''}` : 'no matches';
  }
  if (name === 'glob') {
    const n = countNonEmpty(output);
    return n > 0 ? `${n} file${n !== 1 ? 's' : ''}` : 'no files';
  }
  if (name === 'list_dir') {
    const n = countNonEmpty(output);
    return n > 0 ? `${n} item${n !== 1 ? 's' : ''}` : 'empty';
  }
  if (name === 'read_file' || name === 'ast_get_symbol') {
    const n = output.split('\n').length;
    return `${n} line${n !== 1 ? 's' : ''}`;
  }
  if (['write_file', 'edit_file', 'str_replace_editor', 'patch_file'].includes(name)) {
    const first = firstNonEmptyLine(output);
    return first ? truncate(first) : null;
  }
  const first = firstNonEmptyLine(output);
  return first ? truncate(first) : null;
};

interface ActivityCategory {
  verb: string;
  preposition: string;
  unit: string;
  unitPlural: string;
}

const TOOL_CATEGORY: Record<string, ActivityCategory> = {
  grep:            { verb: 'Searching', preposition: 'for', unit: 'pattern',     unitPlural: 'patterns'    },
  search_files:    { verb: 'Searching', preposition: 'for', unit: 'pattern',     unitPlural: 'patterns'    },
  glob:            { verb: 'Searching', preposition: 'for', unit: 'pattern',     unitPlural: 'patterns'    },
  read_file:       { verb: 'Reading',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  find_definition: { verb: 'Reading',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  analyze_code:    { verb: 'Reading',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  ast_analyzer:    { verb: 'Analyzing', preposition: '',    unit: 'file',         unitPlural: 'files'       },
  bash:            { verb: 'Running',   preposition: '',    unit: 'command',      unitPlural: 'commands'    },
  // edit_file, write_file, patch_file intentionally grouped as "Editing" in the multi-tool summary
  // even though individually they display as "Editing"/"Writing"/"Patching" via TOOL_VERB
  edit_file:       { verb: 'Editing',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  write_file:      { verb: 'Editing',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  patch_file:      { verb: 'Editing',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  delete_file:     { verb: 'Deleting',  preposition: '',    unit: 'file',         unitPlural: 'files'       },
  list_dir:        { verb: 'Listing',   preposition: '',    unit: 'directory',    unitPlural: 'directories' },
  git_diff:        { verb: 'Running',   preposition: '',    unit: 'git command',  unitPlural: 'git commands'},
  git_log:         { verb: 'Running',   preposition: '',    unit: 'git command',  unitPlural: 'git commands'},
  rename_symbol:   { verb: 'Renaming',  preposition: '',    unit: 'symbol',       unitPlural: 'symbols'     },
};

export function buildActivitySummary(activities: ToolActivity[]): string {
  const running = activities.filter(a => a.status === 'running');
  if (running.length === 0) return '';

  const order: string[] = [];
  const grouped = new Map<string, { cat: ActivityCategory; count: number }>();

  for (const activity of running) {
    const cat = TOOL_CATEGORY[activity.name];
    if (!cat) continue;
    const key = `${cat.verb}:${cat.preposition}`;
    if (!grouped.has(key)) {
      order.push(key);
      grouped.set(key, { cat, count: 0 });
    }
    grouped.get(key)!.count++;
  }

  if (order.length === 0) return '';

  const parts = order.map((key, i) => {
    const { cat, count } = grouped.get(key)!;
    const verb = i === 0 ? cat.verb : cat.verb.toLowerCase();
    const prep = cat.preposition ? `${cat.preposition} ` : '';
    const unit = count === 1 ? cat.unit : cat.unitPlural;
    return `${verb} ${prep}${count} ${unit}`;
  });

  return parts.join(', ') + '…';
}

export function buildActivityFileRef(activities: ToolActivity[]): string | null {
  const running = activities
    .filter(a => a.status === 'running' && a.startedAt != null)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  if (running.length === 0) return null;
  return getToolLabel(running[0].name, running[0].input) || null;
}
