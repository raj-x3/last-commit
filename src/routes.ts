export type Route = '/' | '/investigate';

export function routeOf(pathname: string): Route {
  return pathname.replace(/\/+$/, '') === '/investigate' ? '/investigate' : '/';
}
