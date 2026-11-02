// The JetBrains-style log filter lives above both the branches pane (left) and the log (centre), so the
// repository view owns it and shares it through this context.
import { createContext, useContext } from 'react';
import { NO_FILTER, type LogFilter } from '../../lib/jb';

export interface JbFilterValue {
  filter: LogFilter;
  setFilter: (f: LogFilter) => void;
}

export const JbFilterCtx = createContext<JbFilterValue>({ filter: NO_FILTER, setFilter: () => {} });
export const useJbFilter = () => useContext(JbFilterCtx);
