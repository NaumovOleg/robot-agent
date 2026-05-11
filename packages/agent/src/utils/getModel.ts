import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ProfileConfig } from '@robocode-packages/core';
import { ALL_TOOLS } from '@robocode-packages/tools';

export const getModel = (streaming = true, cwd?: string) => {
  const profile = ProfileConfig.active();
  if (!profile) throw new Error('No active profile');

  const opts = { apiKey: profile.apiKey, model: profile.model, streaming };

  const model = profile.provider === 'anthropic' ? new ChatAnthropic(opts) : new ChatOpenAI(opts);

  return model.bindTools(ALL_TOOLS, {
    tool_choice: 'auto',
    ...(cwd ? { configurable: { cwd } } : {}),
  });
};
