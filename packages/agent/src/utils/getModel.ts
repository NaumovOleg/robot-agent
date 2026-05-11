import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ProfileConfig } from '@robocode-packages/core';
import { ALL_TOOLS } from '@robocode-packages/tools';

export const getModel = (streaming = true) => {
  const profile = ProfileConfig.active();
  if (!profile) throw new Error('No active profile');

  const opts = { apiKey: profile.apiKey, model: profile.model, streaming };

  if (profile.provider === 'anthropic') {
    return new ChatAnthropic(opts).bindTools(ALL_TOOLS);
  }
  return new ChatOpenAI(opts).bindTools(ALL_TOOLS);
};
