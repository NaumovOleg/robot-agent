import React from 'react';
import { Box, Text } from 'ink';
import { DiffLine } from '@types';
import { truncate, COLORS } from '@utils';

export const renderLineWithInline = (line: DiffLine, width: number): React.ReactNode => {
  const isAdd = line.type === 'add';
  const isRemove = line.type === 'remove';
  const bgColor = isAdd ? COLORS.addBg : isRemove ? COLORS.removeBg : undefined;
  const textColor = isAdd ? COLORS.addText : isRemove ? COLORS.removeText : COLORS.contextText;
  const lineNr = isAdd ? line.newLineNo : isRemove ? line.oldLineNo : line.oldLineNo;
  const sign = isAdd ? '+' : isRemove ? '-' : ' ';
  const signColor = isAdd ? COLORS.addSign : isRemove ? COLORS.removeSign : undefined;

  if (line.type === 'context') {
    const content = truncate(line.content, width - 7);
    return (
      <Box key={`${line.type}-${lineNr}`}>
        <Box width={7} marginRight={1}>
          <Text dimColor>{String(lineNr ?? '').padStart(4)}</Text>
          <Text color={signColor}> {sign} </Text>
        </Box>
        <Text color={textColor} dimColor>
          {content}
        </Text>
      </Box>
    );
  }

  const inlineChanges = line.inlineChanges ?? [];
  const maxContentWidth = width - 7;
  let consumed = 0;
  const fragments: React.ReactNode[] = [];

  for (const frag of inlineChanges) {
    // Skip fragments that belong to the other side of the change.
    // A remove row shows the OLD content: skip added-only fragments.
    // An add row shows the NEW content: skip removed-only fragments.
    if (isRemove && frag.added) continue;
    if (isAdd && frag.removed) continue;

    let fragmentText = frag.value;
    const remaining = maxContentWidth - consumed;
    if (remaining <= 0) break;
    if (fragmentText.length > remaining) {
      fragmentText = fragmentText.slice(0, remaining - 1) + '…';
    }
    let bg = bgColor;

    if (frag.added && isAdd) {
      bg = COLORS.inlineAddBg;
    } else if (frag.removed && isRemove) {
      bg = COLORS.inlineRemoveBg;
    }
    fragments.push(
      <Text backgroundColor={bg}>
        <Text key={`${lineNr}-${consumed}`}>{fragmentText}</Text>
      </Text>
    );
    consumed += fragmentText.length;
    if (consumed >= maxContentWidth) break;
  }

  return (
    <Box key={`${line.type}-${lineNr}`}>
      <Box width={7} marginRight={1}>
        <Text color={isAdd ? COLORS.addLineNr : COLORS.removeLineNr}>
          {String(lineNr ?? '').padStart(4)}
        </Text>
        <Text color={signColor} bold>
          {sign}
        </Text>
      </Box>
      <Box>{fragments}</Box>
    </Box>
  );
};
