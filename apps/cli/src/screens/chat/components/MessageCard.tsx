import React from 'react';
import { Box, Text } from 'ink';
import type { BaseMessage } from '@langchain/core/messages';
import { messageType } from '@robocode-packages/shared';
import { PALETTE } from '@utils';

type Role = 'human' | 'ai' | 'system';

const FENCE_RE = /```([\w-]+)?\n([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;

const KEYWORDS: Record<string, string[]> = {
  typescript: ['const', 'let', 'function', 'return', 'type', 'interface', 'class', 'async', 'await', 'import', 'export', 'from', 'extends', 'implements', 'new', 'if', 'else', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'throw'],
  javascript: ['const', 'let', 'function', 'return', 'class', 'async', 'await', 'import', 'export', 'from', 'new', 'if', 'else', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'throw'],
  ts: ['const', 'let', 'function', 'return', 'type', 'interface', 'class', 'async', 'await', 'import', 'export', 'from', 'extends', 'implements', 'new'],
  js: ['const', 'let', 'function', 'return', 'class', 'async', 'await', 'import', 'export', 'from', 'new'],
  python: ['def', 'return', 'class', 'import', 'from', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'raise', 'async', 'await', 'with', 'as', 'lambda'],
  json: ['true', 'false', 'null'],
  bash: ['cd', 'ls', 'cat', 'grep', 'find', 'git', 'pnpm', 'npm', 'yarn', 'mkdir', 'rm', 'cp', 'mv', 'echo', 'export'],
};

const highlightLine = (line: string, language = ''): React.ReactNode[] => {
  const keywords = KEYWORDS[language.toLowerCase()] ?? [];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  const patterns = [
    { re: /\/\/.*$/, color: PALETTE.muted },
    { re: /#.*$/, color: PALETTE.muted },
    { re: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, color: PALETTE.sage },
    { re: /\b\d+(\.\d+)?\b/, color: PALETTE.amber },
    { re: new RegExp(`\\b(${keywords.join('|')})\\b`), color: PALETTE.teal },
  ].filter((p) => p.re.source !== '\\b()\\b');

  while (cursor < line.length) {
    let matchIndex = -1;
    let matchLength = 0;
    let color: string = PALETTE.aiText;

    for (const pattern of patterns) {
      pattern.re.lastIndex = 0;
      const slice = line.slice(cursor);
      const match = slice.match(pattern.re);
      if (!match || match.index === undefined) continue;
      if (matchIndex === -1 || match.index < matchIndex) {
        matchIndex = match.index;
        matchLength = match[0].length;
        color = pattern.color;
      }
    }

    if (matchIndex === -1) {
      nodes.push(<Text key={`${cursor}-end`} color={PALETTE.aiText}>{line.slice(cursor)}</Text>);
      break;
    }
    if (matchIndex > 0) {
      nodes.push(<Text key={`${cursor}-plain`} color={PALETTE.aiText}>{line.slice(cursor, cursor + matchIndex)}</Text>);
    }
    nodes.push(<Text key={`${cursor}-match`} color={color}>{line.slice(cursor + matchIndex, cursor + matchIndex + matchLength)}</Text>);
    cursor += matchIndex + matchLength;
  }

  if (nodes.length === 0) nodes.push(<Text key="empty">{line}</Text>);
  return nodes;
};

const renderContent = (content: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let blockIndex = 0;
  FENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(content))) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) {
      before.split(/\n\s*\n/).forEach((para, pi) => {
        const parts = para.split(INLINE_CODE_RE);
        nodes.push(
          <Box key={`p-${blockIndex}-${pi}`} marginBottom={1} flexDirection="column">
            <Text color={PALETTE.aiText}>
              {parts.map((part, i) =>
                i % 2 === 1
                  ? <Text key={i} color={PALETTE.teal}>{part}</Text>
                  : part
              )}
            </Text>
          </Box>
        );
      });
    }

    const language = (match[1] ?? '').trim();
    const codeLines = match[2].replace(/\r\n/g, '\n').split('\n');

    nodes.push(
      <Box key={`code-${blockIndex}`} flexDirection="column" marginBottom={1} paddingLeft={1}>
        <Box gap={1}>
          <Text color={PALETTE.faint}>│</Text>
          <Text color={PALETTE.muted} dimColor>code</Text>
          {language ? <><Text color={PALETTE.faint}>·</Text><Text color={PALETTE.teal}>{language}</Text></> : null}
        </Box>
        {codeLines.map((line, i) => (
          <Box key={i} gap={1}>
            <Text color={PALETTE.faint}>│</Text>
            <Text color={PALETTE.faint} dimColor>{String(i + 1).padStart(3)}</Text>
            <Text>{highlightLine(line, language)}</Text>
          </Box>
        ))}
      </Box>
    );

    lastIndex = match.index + match[0].length;
    blockIndex++;
  }

  const tail = content.slice(lastIndex);
  if (tail.trim()) {
    tail.split(/\n\s*\n/).forEach((para, pi) => {
      const parts = para.split(INLINE_CODE_RE);
      nodes.push(
        <Box key={`tail-${pi}`} marginBottom={1} flexDirection="column">
          <Text color={PALETTE.aiText}>
            {parts.map((part, i) =>
              i % 2 === 1
                ? <Text key={i} color={PALETTE.teal}>{part}</Text>
                : part
            )}
          </Text>
        </Box>
      );
    });
  }

  if (nodes.length === 0) {
    nodes.push(<Box key="empty" marginBottom={1}><Text color={PALETTE.muted} dimColor>(empty)</Text></Box>);
  }

  return nodes;
};

export const MessageCard: React.FC<{ msg: BaseMessage }> = ({ msg }) => {
  const role = messageType(msg) as Role;
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);

  if (role === 'human') {
    return (
      <Box marginBottom={1}>
        <Text color={PALETTE.muted}>❯ </Text>
        <Text color={PALETTE.userText}>{content}</Text>
      </Box>
    );
  }

  if (role === 'system') {
    return (
      <Box marginBottom={1}>
        <Text color={PALETTE.slate} dimColor>◆ {content}</Text>
      </Box>
    );
  }

  // ai
  return (
    <Box flexDirection="column" marginBottom={1}>
      {renderContent(content)}
    </Box>
  );
};
