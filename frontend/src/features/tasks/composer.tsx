import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { TaskStatus } from "../../types/Task";

export interface ComposerDefaults {
  projectId?: string;
  status?: TaskStatus;
  dueDate?: string;
  parentId?: number;
  assigneeId?: number;
}

const ComposerContext = createContext<{ defaults: ComposerDefaults | null; open: (d: ComposerDefaults) => void; close: () => void }>({
  defaults: null,
  open: () => {},
  close: () => {},
});

export const ComposerProvider = ({ children }: { children: ReactNode }) => {
  const [defaults, setDefaults] = useState<ComposerDefaults | null>(null);
  const open = useCallback((d: ComposerDefaults) => setDefaults(d), []);
  const close = useCallback(() => setDefaults(null), []);
  const value = useMemo(() => ({ defaults, open, close }), [defaults, open, close]);
  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useComposer = () => useContext(ComposerContext);

/** The open task lives in the URL (?task=42) so it survives reloads and can be linked. */
// eslint-disable-next-line react-refresh/only-export-components
export const useTaskParam = () => {
  const [params, setParams] = useSearchParams();
  const raw = params.get("task");
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  const openTask = useCallback(
    (taskId: number) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set("task", String(taskId));
        return next;
      }),
    [setParams]
  );
  const closeTask = useCallback(
    () =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.delete("task");
        return next;
      }),
    [setParams]
  );
  return { taskId: id, openTask, closeTask };
};
