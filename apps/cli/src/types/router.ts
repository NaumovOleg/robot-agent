export type Route = 'welcome' | 'profile' | 'assistant' | 'settings';
export enum Routes {
  'welcome' = 'welcome',
  'profile' = 'profile',
  'assistant' = 'assistant',
  'settings' = 'settings',
}

export interface RouterState {
  route: Route;
  navigate: (route: Route) => void;
  back: () => void;
}
