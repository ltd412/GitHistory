// Original line icons drawn for this app (24×24 grid, stroke-based).
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (d: React.ReactNode, props: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {d}
  </svg>
);

export const IconBranch = (p: P) => base(<><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="7" r="2.2" /><path d="M6 7.2v9.6M18 9.2c0 5-6 4-11 8" /></>, p);
export const IconMerge = (p: P) => base(<><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="12" r="2.2" /><path d="M6 7.2v9.6M6.6 7.4c1.6 3 5 4.6 9.2 4.6" /></>, p);
export const IconSun = (p: P) => base(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>, p);
export const IconMoon = (p: P) => base(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />, p);
export const IconCloud = (p: P) => base(<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.3 4.4 4.4 0 0 0 7 18z" />, p);
export const IconLaptop = (p: P) => base(<><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>, p);
export const IconTag = (p: P) => base(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.4" /></>, p);
export const IconStash = (p: P) => base(<><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>, p);
export const IconPop = (p: P) => base(<><rect x="3" y="9" width="18" height="5" rx="1" /><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5M12 2v5M9.5 4.5 12 2l2.5 2.5" /></>, p);
export const IconPull = (p: P) => base(<><path d="M12 3v13M6.5 10.5 12 16l5.5-5.5M4 21h16" /></>, p);
export const IconPush = (p: P) => base(<><path d="M12 21V8M6.5 13.5 12 8l5.5 5.5M4 3h16" /></>, p);
export const IconFetch = (p: P) => base(<><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" /></>, p);
export const IconUndo = (p: P) => base(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>, p);
export const IconRedo = (p: P) => base(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></>, p);
export const IconTerminal = (p: P) => base(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>, p);
export const IconFolder = (p: P) => base(<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />, p);
export const IconSearch = (p: P) => base(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>, p);
export const IconChevron = (p: P) => base(<path d="m6 9 6 6 6-6" />, p);
export const IconCheck = (p: P) => base(<path d="m5 12.5 4.5 4.5L19 7.5" />, p);
export const IconPlus = (p: P) => base(<path d="M12 5v14M5 12h14" />, p);
export const IconMinus = (p: P) => base(<path d="M5 12h14" />, p);
export const IconX = (p: P) => base(<path d="M6 6l12 12M18 6 6 18" />, p);
export const IconTrash = (p: P) => base(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>, p);
export const IconArrowUp = (p: P) => base(<path d="M12 19V5M6 11l6-6 6 6" />, p);
export const IconArrowDown = (p: P) => base(<path d="M12 5v14M6 13l6 6 6-6" />, p);
export const IconFile = (p: P) => base(<><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3v5h5" /></>, p);
export const IconHistory = (p: P) => base(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>, p);
export const IconBlame = (p: P) => base(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>, p);
export const IconSettings = (p: P) => base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>, p);
export const IconRemote = (p: P) => base(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>, p);
export const IconSubmodule = (p: P) => base(<><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /><path d="M7 11v4a2 2 0 0 0 2 2h4" /></>, p);
export const IconClone = (p: P) => base(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>, p);
export const IconInit = (p: P) => base(<><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /><path d="M12 10v6M9 13h6" /></>, p);
export const IconLogo = (p: P) =>
  base(
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 8.5v7M8.3 7.1C13 9 15.5 9.5 15.6 11M8.3 16.9C13 15 15.5 14.5 15.6 13" />
    </>,
    p,
  );

const STATUS_ICON: Record<string, React.ReactNode> = {
  A: <IconPlus />,
  '?': <IconPlus />,
  D: <IconMinus />,
  M: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0" /></svg>,
  T: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0" /></svg>,
  R: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M4 12h15M14 7l5 5-5 5" /></svg>,
  C: <IconClone />,
  U: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}><path d="M12 5v9M12 18.5v.5" /></svg>,
};

export function StatusIcon({ status }: { status: string }) {
  const s = status === '?' ? 'A' : status;
  return (
    <span className={`st st-${s}`} title={STATUS_LABEL[s] ?? s}>
      {STATUS_ICON[s] ?? s}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Conflicted',
};
