// Small utility hooks shared across the app.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// localStorage-persisted state (JSON-serialized).
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setState((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore quota */
        }
        return next;
      });
    },
    [key],
  );
  return [state, set];
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Detect the Electron shell (window.collectory bridge).
export function useIsElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { collectory?: unknown }).collectory;
}

// Guard against unsaved form navigation. Returns a ref-safe dirty flag setter.
export function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

// Minimal Navigator shape we depend on (react-router's UNSAFE navigator).
interface BlockableNavigator {
  push: (...args: unknown[]) => void;
  replace: (...args: unknown[]) => void;
  go: (delta: number) => void;
}

// In-app navigation guard for unsaved work. Works with the declarative
// <BrowserRouter> (useBlocker requires a data router, which the app does not
// use): patches the navigator's push/replace and intercepts browser Back
// (popstate) to confirm before discarding. `message` shown via window.confirm.
// Also covers hard unload via useBeforeUnload. Combine both for full coverage.
// Returns a `disarm()` to bypass the guard for an intentional navigation (e.g.
// after deleting the record you were editing) without a spurious prompt.
export function useNavigationBlocker(
  active: boolean,
  message = 'You have unsaved changes. Leave without saving?',
): () => void {
  const { navigator } = useContext(UNSAFE_NavigationContext) as {
    navigator: BlockableNavigator;
  };
  const disarmRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active) {
      disarmRef.current = () => {};
      return;
    }

    const confirmLeave = () => window.confirm(message);
    const { push, replace } = navigator;

    let released = false;
    const restore = () => {
      if (released) return;
      released = true;
      navigator.push = push;
      navigator.replace = replace;
      window.removeEventListener('popstate', onPopState);
    };
    disarmRef.current = restore;

    // ---- Intercept in-app navigation (<Link>, navigate(), etc.) ----
    navigator.push = (...args: unknown[]) => {
      if (confirmLeave()) push.apply(navigator, args);
    };
    navigator.replace = (...args: unknown[]) => {
      if (confirmLeave()) replace.apply(navigator, args);
    };

    // ---- Intercept browser Back/Forward (popstate) ----
    // Push a sentinel state so the first Back stays on this page; on popstate
    // confirm, then either allow (go back again, unguarded) or re-push.
    window.history.pushState(null, '', window.location.href);
    function onPopState() {
      if (confirmLeave()) {
        restore(); // let the real back navigate unguarded
        navigator.go(-1);
      } else {
        window.history.pushState(null, '', window.location.href);
      }
    }
    window.addEventListener('popstate', onPopState);

    return restore;
  }, [active, message, navigator]);

  return useCallback(() => disarmRef.current(), []);
}

// Keyboard shortcut hook. combos like 'mod+k' (mod = cmd on mac, ctrl elsewhere).
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;
  useEffect(() => {
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const needMod = parts.includes('mod');
    const needShift = parts.includes('shift');
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (needMod && !mod) return;
      if (!needMod && mod) return;
      if (needShift && !e.shiftKey) return;
      if (e.key.toLowerCase() !== key) return;
      savedHandler.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
