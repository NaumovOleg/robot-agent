import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ProfileConfig } from '@robocode-packages/core';

export const createBaseModel = (streaming = false) => {
  const profile = ProfileConfig.active();
  if (!profile) throw new Error('No active profile');

  const opts = {
    apiKey: profile.apiKey,
    model: profile.model,
    streaming: streaming && profile.supportsStreaming !== false,
  };

  return profile.provider === 'anthropic' ? new ChatAnthropic(opts) : new ChatOpenAI(opts);
};

export const getModel = (streaming = true) => {
  return createBaseModel(streaming);
};
