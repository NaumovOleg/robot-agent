export type Route = 'welcome' | 'profile' | 'assistant' | 'history' | 'settings';
export enum Routes {
  'welcome' = 'welcome',
  'profile' = 'profile',
  'assistant' = 'assistant',
  'history' = 'history',
  'settings' = 'settings',
}

export interface RouterState {
  route: Route;
  navigate: (route: Route) => void;
  back: () => void;
}
