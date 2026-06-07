// apps/cli/src/utils/turnSummary.ts
import type { ToolActivity, TurnSummaryData } from '../types/chat';

const VERB_MAP: Record<string, string> = {
  read_file:          'Read',
  list_dir:           'Read',
  find_definition:    'Read',
  ast_analyzer:       'Read',
  ast_get_symbol:     'Read',
  grep:               'Searched',
  glob:               'Searched',
  search_files:       'Searched',
  write_file:         'Wrote',
  edit_file:          'Patched',
  patch_file:         'Patched',
  str_replace_editor: 'Patched',
  bash:               'Ran',
  validate_project:   'Validated',
  undo:               'Undid',
};

function groupVerb(name: string): string {
  return VERB_MAP[name] ?? name;
}

function collectActivities(activities: ToolActivity[]): ToolActivity[] {
  const flat: ToolActivity[] = [];
  for (const a of activities) {
    flat.push(a);
    if (a.children) flat.push(...a.children);
  }
  return flat;
}

export function buildTurnSummary(
  activities: ToolActivity[],
  usage: { tokens: number; cost: number } = { tokens: 0, cost: 0 }
): TurnSummaryData {
  const flat = collectActivities(activities);
  const counts = new Map<string, number>();
  let minStart = Infinity;
  let maxEnd = 0;
  let hasError = false;

  for (const a of flat) {
    const verb = groupVerb(a.name);
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
    if (a.startedAt !== undefined && a.startedAt < minStart) minStart = a.startedAt;
    if (a.finishedAt !== undefined && a.finishedAt > maxEnd) maxEnd = a.finishedAt;
    if (a.status === 'error') hasError = true;
  }

  const groups = [...counts.entries()].map(([verb, count]) => ({ verb, count }));
  const durationSec =
    minStart < Infinity && maxEnd > 0
      ? Math.round((maxEnd - minStart) / 1000)
      : 0;

  return { groups, durationSec, timestamp: Date.now(), hasError, tokens: usage.tokens, cost: usage.cost };
}
