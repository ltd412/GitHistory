// The JetBrains-style log filter lives above both the branches pane and the log, so the repository tab owns
// it and shares it through this context (same as the desktop's jb/JbFilter.tsx).
import { createContext, useContext } from "react";
import { NO_FILTER, type LogFilter } from "../../shared/core/jb";

export interface JbFilterValue {
  filter: LogFilter;
  setFilter: (f: LogFilter) => void;
}

export const JbFilterCtx = createContext<JbFilterValue>({ filter: NO_FILTER, setFilter: () => {} });
export const useJbFilter = () => useContext(JbFilterCtx);
