import { useEffect, useRef, type RefObject } from 'react';

/**
 * Moves keyboard and screen-reader focus to the page heading inside `root`, so a view switch announces where you are.
 * Some pages draw their heading only after they load, so when it is not there yet this waits for it, up to a few seconds.
 * Returns a cleanup that stops waiting.
 */
export function focusPageHeading(root: HTMLElement): () => void {
  const focusNow = (): boolean => {
    const h1 = root.querySelector<HTMLElement>('h1');
    if (!h1) return false;
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
    h1.focus({ preventScroll: true });
    return true;
  };
  if (focusNow()) return () => undefined;
  const observer = new MutationObserver(() => {
    if (focusNow()) stop();
  });
  const timer = window.setTimeout(() => stop(), 3000);
  function stop(): void {
    observer.disconnect();
    window.clearTimeout(timer);
  }
  observer.observe(root, { childList: true, subtree: true });
  return stop;
}

/**
 * After a row is deleted its button is gone and focus would drop to the page. Call `removed(index)` once the delete
 * succeeded; when `list` next changes, focus lands on the first button of the row that took its place, or on
 * `fallback` (the list heading) when the list is now empty.
 */
export function useFocusAfterRemove(list: unknown, fallback: () => HTMLElement | null): { listRef: RefObject<HTMLUListElement | null>; removed: (index: number) => void } {
  const listRef = useRef<HTMLUListElement>(null);
  const pending = useRef<number | null>(null);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  useEffect(() => {
    if (pending.current === null) return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>(':scope > li') ?? [];
    const row = rows[Math.min(pending.current, rows.length - 1)];
    pending.current = null;
    const target = row?.querySelector<HTMLElement>('button:not([disabled]), input, textarea, a[href]') ?? fallbackRef.current();
    target?.focus();
  }, [list]);
  return { listRef, removed: (index) => void (pending.current = index) };
}
