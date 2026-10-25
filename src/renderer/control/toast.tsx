import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface ToastOptions {
  kind?: 'ok' | 'error';
  /** A button on the toast, such as Undo. */
  action?: { label: string; run: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

type Push = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<Push>(() => undefined);
export const useToast = (): Push => useContext(ToastContext);

const SHOW_MS = { ok: 6000, error: 12000, withAction: 9000 };

/**
 * Every change gets a confirmation that survives switching views. The region is a polite live region, so a screen
 * reader announces each message without taking focus.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>(
    (message, options = {}) => {
      const id = next.current++;
      setItems((all) => [...all.slice(-3), { id, message, ...options }]);
      const ms = options.action ? SHOW_MS.withAction : SHOW_MS[options.kind ?? 'ok'];
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind ?? 'ok'}`}>
            <span className="toast-mark" aria-hidden="true">
              {t.kind === 'error' ? '!' : '✓'}
            </span>
            <span className="toast-text">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="btn btn-quiet toast-close" aria-label="Dismiss message" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
