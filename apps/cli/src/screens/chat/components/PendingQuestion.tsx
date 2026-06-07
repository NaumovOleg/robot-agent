import React from 'react';
import { QuestionPrompt } from './QuestionPrompt';

interface Props {
  question: string;
  questionIndex?: number;
  totalQuestions?: number;
}

export const PendingQuestion: React.FC<Props> = ({ question, questionIndex, totalQuestions }) => (
  <QuestionPrompt question={question} questionIndex={questionIndex} totalQuestions={totalQuestions} />
);
