import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { routeOf, type Route } from './routes.ts';

export type { Route };

/** A tiny History API router for two pages. The server already serves index.html for extension-less paths. */

const EVENT = 'lastcommit:navigate';
let navigations = 0;

function snapshot(): string {
  return `${window.location.pathname}|${window.location.hash}|${navigations}`;
}

function subscribe(notify: () => void): () => void {
  window.addEventListener(EVENT, notify);
  window.addEventListener('popstate', notify);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener('popstate', notify);
  };
}

/** Re-renders on navigation. `key` changes on every navigation, including same-page hash links. */
export function useLocation(): { route: Route; hash: string; key: string; navigated: boolean } {
  const key = useSyncExternalStore(subscribe, snapshot, () => '/||0');
  return { route: routeOf(window.location.pathname), hash: window.location.hash, key, navigated: navigations > 0 };
}

export function navigate(to: string): void {
  const url = new URL(to, window.location.origin);
  if (url.origin !== window.location.origin) {
    window.location.assign(to);
    return;
  }
  const next = url.pathname + url.search + url.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) {
    window.history.pushState({}, '', next);
  }
  navigations += 1;
  window.dispatchEvent(new Event(EVENT));
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  children: ReactNode;
}

/** A normal anchor that navigates without a reload. Modified clicks keep the browser's behaviour. */
export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== '_self') return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a {...rest} href={to} onClick={handle}>
      {children}
    </a>
  );
}
