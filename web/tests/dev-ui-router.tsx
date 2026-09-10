/** Browser-only router adapter for the isolated UI fixture, never a production route. */
import React, { useSyncExternalStore } from "react";
const subscribe = (listener: () => void) => { window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); };
export const usePathname = () => useSyncExternalStore(subscribe, () => window.location.pathname, () => "/dev");
export const useLocation = () => useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search, () => "/dev");
export function useRouter() {
  return { push(href: string) { history.pushState(null, "", href); window.dispatchEvent(new PopStateEvent("popstate")); }, refresh() { window.dispatchEvent(new PopStateEvent("popstate")); } };
}
export default function Link({ href, scroll: _scroll, children, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; scroll?: boolean }) {
  const router = useRouter();
  return <a {...props} href={href} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || props.download) return;
    event.preventDefault(); router.push(href);
  }}>{children}</a>;
}
