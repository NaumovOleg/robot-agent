import { normalizeProfile, type Profile } from '@robocode-packages/shared';

export const formatProfileContext = (profile: Profile | null): string => {
  if (!profile) return '';

  const normalized = normalizeProfile(profile);
  return [
    '## Active profile',
    `- Provider: ${normalized.provider}`,
    `- Model: ${normalized.model}`,
    `- Streaming: ${normalized.supportsStreaming ? 'enabled' : 'disabled'}`,
    `- Context window: ${normalized.contextWindowHint}`,
    `- Cost tier: ${normalized.costTier}`,
  ].join('\n');
};
