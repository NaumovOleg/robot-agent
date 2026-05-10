export interface Profile {
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  active: boolean;
  id: string;
}

export interface Config {
  profiles: Profile[];
}
