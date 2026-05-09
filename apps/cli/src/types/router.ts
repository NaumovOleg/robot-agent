export type Route = 'welcome' | 'login' | 'chat' | 'settings';

export interface RouterState {
  route: Route;
  push: (route: Route) => void;

  back: () => void;
}
