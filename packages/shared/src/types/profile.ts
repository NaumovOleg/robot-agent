export interface Profile {
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  active: boolean;
}

export interface Config {
  profiles: Profile[];
}
