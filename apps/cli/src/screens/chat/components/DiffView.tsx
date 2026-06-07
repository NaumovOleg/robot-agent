import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { DiffLine } from '@types';
import { computeInlineChanges, COLORS, buildDetailedRows, splitLines } from '@utils';
import { renderLineWithInline } from '@components';

interface Props {
  oldStr?: string;
  newStr?: string;
  startLine?: number;

  maxLines?: number;
  replacedLines?: { oldLines: string[]; newLines: string[]; startLine: number };
  fullFileContent?: string;
  patches?: { oldStr: string; newStr: string }[];
}

export const DiffView: React.FC<Props> = ({
  oldStr = '',
  newStr = '',
  startLine,

  maxLines = 50,
  replacedLines,
  fullFileContent,
  patches,
}) => {
  const { stdout } = useStdout();
  const width = Math.max((stdout?.columns ?? 80) - 2, 40);

  const { rows, summary } = useMemo(() => {
    if (patches && patches.length > 0) {
      const allRows: DiffLine[] = [];
      for (const patch of patches) {
        const oldL = splitLines(patch.oldStr);
        const newL = splitLines(patch.newStr);
        const patchRows = buildDetailedRows(oldL, newL);
        allRows.push(...patchRows);
      }
      return {
        rows: allRows,
        mode: 'patch' as const,
        summary: `${patches.length} hunk${patches.length === 1 ? '' : 's'}`,
      };
    }

    if (replacedLines) {
      const rows = buildDetailedRows(replacedLines.oldLines, replacedLines.newLines, replacedLines.startLine);
      return { rows, mode: 'edit' as const, summary: undefined };
    }

    if (fullFileContent) {
      const newL = splitLines(fullFileContent);
      const rows = newL.map((line, idx) => ({
        type: 'add' as const,
        newLineNo: idx + 1,
        content: line,
        inlineChanges: computeInlineChanges('', line),
      }));
      return { rows, mode: 'write' as const, summary: undefined };
    }

    const rows = buildDetailedRows(splitLines(oldStr), splitLines(newStr), startLine ?? 1);
    return { rows, mode: 'edit' as const, summary: undefined };
  }, [oldStr, newStr, replacedLines, fullFileContent, patches]);

  const displayRows = rows.slice(0, maxLines);
  const hasMore = rows.length > maxLines;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box gap={1}>{summary && <Text color={COLORS.dimmed}> ({summary})</Text>}</Box>
      <Box flexDirection="column" marginTop={0}>
        {displayRows.map((row) => renderLineWithInline(row, width))}
        {hasMore && (
          <Box marginTop={0}>
            <Text color={COLORS.dimmed} dimColor>
              ... {rows.length - maxLines} more lines
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
