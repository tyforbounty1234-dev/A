'use client';
/**
 * Minimal hash router used only by the single-file build (`npm run build:single`).
 * It stands in for `next/link` and `next/navigation`, so the same pages run
 * without a server: "/words/abc?x=1" lives in the URL as "#/words/abc?x=1".
 */
import { createContext, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface Location {
  pathname: string;
  search: string;
  params: Record<string, string>;
}

const Ctx = createContext<Location>({ pathname: '/', search: '', params: {} });

function readHash(): { pathname: string; search: string } {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathname, search = ''] = raw.split('?');
  return { pathname: pathname || '/', search };
}

export function navigate(href: string, replace = false) {
  const url = `#${href.startsWith('/') ? href : `/${href}`}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event('lexicore:navigate'));
  window.scrollTo(0, 0);
}

export function useHashLocation() {
  const [loc, setLoc] = useState(readHash);
  useEffect(() => {
    const update = () =>
      setLoc((prev) => {
        const next = readHash();
        return next.pathname === prev.pathname && next.search === prev.search ? prev : next;
      });
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    window.addEventListener('lexicore:navigate', update);
    // A child may have navigated during the first render's effects, before
    // these listeners existed (child effects run before parent effects).
    update();
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
      window.removeEventListener('lexicore:navigate', update);
    };
  }, []);
  return loc;
}

export function RouterProvider({ value, children }: { value: Location; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ----- next/link
export default function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a
      {...rest}
      href={`#${href}`}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

// ----- next/navigation
export function useRouter() {
  return useMemo(() => ({ push: (h: string) => navigate(h), replace: (h: string) => navigate(h, true), back: () => window.history.back() }), []);
}
export function usePathname() {
  return useContext(Ctx).pathname;
}
export function useSearchParams() {
  const { search } = useContext(Ctx);
  return useMemo(() => new URLSearchParams(search), [search]);
}
export function useParams<T extends Record<string, string>>() {
  return useContext(Ctx).params as T;
}
