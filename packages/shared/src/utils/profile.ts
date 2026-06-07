import type {
  Profile,
  ProfileContextWindowHint,
  ProfileCostTier,
} from '../types/profile';

export interface InferredProfileMetadata {
  supportsStreaming: boolean;
  contextWindowHint: ProfileContextWindowHint;
  costTier: ProfileCostTier;
}

const inferContextWindowHint = (provider: string, model: string): ProfileContextWindowHint => {
  const value = `${provider} ${model}`.toLowerCase();

  if (/(mini|small|tiny|haiku|flash|nano)/.test(value)) return 'small';
  if (/(pro|opus|max|sonnet|5|large|ultra)/.test(value)) return 'extended';
  if (/(gpt-4|claude-3|gemini-1|gemini-2)/.test(value)) return 'large';

  return 'medium';
};

const inferCostTier = (provider: string, model: string): ProfileCostTier => {
  const value = `${provider} ${model}`.toLowerCase();

  if (provider === 'ollama' || /(mini|small|tiny|haiku|flash|nano)/.test(value)) return 'low';
  if (/(pro|opus|max|sonnet|large|ultra)/.test(value)) return 'high';

  return 'medium';
};

export const inferProfileMetadata = (provider: string, model: string): InferredProfileMetadata => {
  return {
    supportsStreaming: true,
    contextWindowHint: inferContextWindowHint(provider, model),
    costTier: inferCostTier(provider, model),
  };
};

export const normalizeProfile = (profile: Profile): Profile => {
  const inferred = inferProfileMetadata(profile.provider, profile.model);
  return {
    ...profile,
    supportsStreaming: profile.supportsStreaming ?? inferred.supportsStreaming,
    contextWindowHint: profile.contextWindowHint ?? inferred.contextWindowHint,
    costTier: profile.costTier ?? inferred.costTier,
  };
};

export const getProfileTokenBudget = (profile: Profile | null | undefined): number => {
  const hint = profile?.contextWindowHint ?? inferContextWindowHint(profile?.provider ?? '', profile?.model ?? '');

  switch (hint) {
    case 'small':
      return 4_000;
    case 'medium':
      return 8_000;
    case 'large':
      return 12_000;
    case 'extended':
      return 16_000;
    default:
      return 8_000;
  }
};
