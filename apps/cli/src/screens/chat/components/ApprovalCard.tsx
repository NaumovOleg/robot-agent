import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@utils';
import { DiffView } from './DiffView';

type ApprovalKind =
  | { kind: 'tool'; tool: { name: string; input: unknown } }
  | { kind: 'plan'; plan: string };

type Selection = 'approve' | 'deny' | 'always';

const DESTRUCTIVE_TOOLS = new Set(['write_file', 'edit_file', 'patch_file', 'str_replace_editor', 'undo', 'delete_file', 'rename_symbol']);
const DIFF_TOOLS = new Set(['write_file', 'edit_file', 'patch_file', 'str_replace_editor']);

interface Props {
  approval: ApprovalKind;
  isActive: boolean;
  onConfirm: (result: 'approve' | 'deny' | 'always') => void;
}

export const ApprovalCard: React.FC<Props> = ({ approval, isActive, onConfirm }) => {
  const isDestructive = approval.kind === 'tool' && DESTRUCTIVE_TOOLS.has(approval.tool.name);
  const borderColor = isDestructive ? PALETTE.rust : PALETTE.amber;
  const [selected, setSelected] = useState<Selection>(isDestructive ? 'deny' : 'approve');
  const [diffExpanded, setDiffExpanded] = useState(true);

  const selections: Selection[] = ['approve', 'deny', 'always'];

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') { onConfirm('approve'); return; }
    if (input === 'n' || input === 'N' || key.escape) { onConfirm('deny'); return; }
    if (input === 'a' || input === 'A') { onConfirm('always'); return; }
    if (input === 'd' || input === 'D') { setDiffExpanded(p => !p); return; }
    if (key.leftArrow) {
      setSelected(p => { const i = selections.indexOf(p); return selections[Math.max(0, i - 1)]; });
    }
    if (key.rightArrow) {
      setSelected(p => { const i = selections.indexOf(p); return selections[Math.min(selections.length - 1, i + 1)]; });
    }
    if (key.return || input === ' ') onConfirm(selected);
  }, { isActive });

  const args = approval.kind === 'tool' ? ((approval.tool.input ?? {}) as Record<string, unknown>) : {};
  const targetPath = typeof args.path === 'string' ? args.path : typeof args.file === 'string' ? args.file : '';
  const command = typeof args.command === 'string' ? args.command : '';
  const hasDiff = approval.kind === 'tool' && DIFF_TOOLS.has(approval.tool.name);
  const oldStr = typeof args.oldStr === 'string' ? args.oldStr : '';
  const newStr = typeof args.newStr === 'string' ? args.newStr : '';
  const fileContent = typeof args.content === 'string' ? args.content : '';
  const diffProps = hasDiff ? (oldStr || newStr ? { oldStr, newStr } : { fullFileContent: fileContent }) : null;

  const riskLabel = isDestructive ? 'destructive' : 'moderate';

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2} borderStyle="single" borderColor={borderColor}>
      <Box gap={2} marginBottom={1}>
        <Text color={borderColor} bold>
          {approval.kind === 'plan' ? '╭─ Plan' : '⚠  TOOL APPROVAL REQUIRED'}
        </Text>
      </Box>
      {approval.kind === 'tool' && (
        <Box marginBottom={1}>
          <Text color={PALETTE.muted}>{approval.tool.name}</Text>
          <Text color={PALETTE.faint}> · {riskLabel}</Text>
        </Box>
      )}

      {targetPath && (
        <Box marginBottom={1}>
          <Text color={PALETTE.path}>{targetPath}</Text>
        </Box>
      )}
      {command && (
        <Box marginBottom={1}>
          <Text color={PALETTE.aiText}>{command}</Text>
        </Box>
      )}

      {approval.kind === 'plan' && (
        <Box flexDirection="column" marginBottom={1}>
          {approval.plan.split('\n').filter(l => l.trim()).map((line, i) => (
            <Text key={i} color={PALETTE.aiText}>{line}</Text>
          ))}
        </Box>
      )}

      {hasDiff && diffProps && (
        <Box flexDirection="column" marginBottom={1}>
          {diffExpanded ? (
            <>
              <DiffView {...diffProps} maxLines={40} />
              <Text color={PALETTE.faint} dimColor>d to hide diff</Text>
            </>
          ) : (
            <Text color={PALETTE.muted} dimColor>diff hidden · d to show</Text>
          )}
        </Box>
      )}

      <Box gap={3} marginTop={1} borderStyle="single" borderColor={PALETTE.faint} paddingX={1}>
        {(['approve', 'deny', ...(approval.kind === 'tool' ? ['always'] : [])] as Selection[]).map(opt => (
          <Text key={opt}
            color={selected === opt ? (opt === 'deny' ? PALETTE.rust : opt === 'always' ? PALETTE.teal : PALETTE.sage) : PALETTE.muted}
            bold={selected === opt}
          >
            [{opt === 'approve' ? 'Y' : opt === 'deny' ? 'N' : 'A'}] {opt.charAt(0).toUpperCase() + opt.slice(1)}
          </Text>
        ))}
        <Text color={PALETTE.faint} dimColor>←/→  Enter</Text>
      </Box>
    </Box>
  );
};
