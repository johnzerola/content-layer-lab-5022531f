import { useCallback, useRef, useState } from "react";

export interface EditorSnapshot<T> {
  value: T;
  label: string;
}

/** Histórico de edição com desfazer/refazer e coalescência por tempo
 *  (arrastes contínuos viram um único passo). */
export function useEditorHistory<T>(initial: T, coalesceMs = 450) {
  const [state, setState] = useState<T>(initial);
  const past = useRef<EditorSnapshot<T>[]>([]);
  const future = useRef<EditorSnapshot<T>[]>([]);
  const lastAt = useRef(0);
  const lastLabel = useRef("");
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  const commit = useCallback(
    (next: T | ((prev: T) => T), label = "edição") => {
      setState((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (Object.is(value, prev)) return prev;
        const now = Date.now();
        const merge = label === lastLabel.current && now - lastAt.current < coalesceMs;
        if (!merge) past.current = [...past.current.slice(-99), { value: prev, label }];
        lastAt.current = now;
        lastLabel.current = label;
        future.current = [];
        refresh();
        return value;
      });
    },
    [coalesceMs],
  );

  const undo = useCallback(() => {
    const step = past.current.pop();
    if (!step) return null;
    setState((cur) => {
      future.current = [...future.current, { value: cur, label: step.label }];
      return step.value;
    });
    lastLabel.current = "";
    refresh();
    return step.label;
  }, []);

  const redo = useCallback(() => {
    const step = future.current.pop();
    if (!step) return null;
    setState((cur) => {
      past.current = [...past.current, { value: cur, label: step.label }];
      return step.value;
    });
    lastLabel.current = "";
    refresh();
    return step.label;
  }, []);

  const reset = useCallback((value: T, label = "reset") => {
    setState((prev) => {
      past.current = [...past.current, { value: prev, label }];
      future.current = [];
      refresh();
      return value;
    });
  }, []);

  return {
    state,
    set: commit,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
