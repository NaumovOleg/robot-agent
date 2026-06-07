export type ProfileContextWindowHint = 'small' | 'medium' | 'large' | 'extended';
export type ProfileCostTier = 'low' | 'medium' | 'high';

export interface Profile {
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  active: boolean;
  id: string;
  supportsStreaming?: boolean;
  contextWindowHint?: ProfileContextWindowHint;
  costTier?: ProfileCostTier;
}

export interface Config {
  profiles: Profile[];
}
