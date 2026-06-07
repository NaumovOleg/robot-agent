import React from 'react';
import { Box, Text } from 'ink';

export interface QuestionPromptProps {
  question: string;
  label?: string;
  questionIndex?: number;
  totalQuestions?: number;
}

export const QuestionPrompt: React.FC<QuestionPromptProps> = ({
  question,
  label = 'clarification needed',
  questionIndex,
  totalQuestions,
}) => {
  const hasProgress =
    questionIndex !== undefined && totalQuestions !== undefined && totalQuestions > 1;

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Box gap={1} marginBottom={1}>
        <Text color="yellow">?</Text>
        <Text color="gray" dimColor>{label}</Text>
        {hasProgress && (
          <Text color="gray" dimColor>({questionIndex}/{totalQuestions})</Text>
        )}
      </Box>
      <Text color="white">{question}</Text>
    </Box>
  );
};
