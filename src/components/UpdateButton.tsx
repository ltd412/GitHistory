// The tab bar's update button: appears when a newer release exists; one click downloads it, verifies it and
// installs it (see electron/updater.cjs for what "installs" means per platform).
import type { UpdateState } from '../lib/api';
import { IconArrowDown } from './Icons';

const WHAT: Record<NonNullable<UpdateState['kind']>, string> = {
  deb: 'It is downloaded, checked and installed with sudo (you are asked for your password here), then the app restarts.',
  appimage: 'It is downloaded, checked and replaces this AppImage, then the app restarts.',
  nsis: 'It is downloaded and checked, then the installer opens.',
  dmg: 'It is downloaded and checked, then the disk image opens: drag GitHistory to Applications.',
  manual: 'The release page opens in your browser.',
};

export function UpdateButton({ state, onApply }: { state: UpdateState; onApply: () => void }) {
  const { phase, version, kind = 'manual' } = state;
  if (phase === 'available')
    return (
      <button className="update-btn" onClick={onApply} title={`Update to GitHistory ${version}. ${WHAT[kind]}`}>
        <IconArrowDown width={13} height={13} />
        Update to {version}
      </button>
    );
  if (phase === 'downloading')
    return (
      <button className="update-btn busy" disabled title={`Downloading GitHistory ${version}`}>
        <span className="update-bar" style={{ width: `${state.progress ?? 0}%` }} />
        <span className="update-txt">Downloading {state.progress ?? 0}%</span>
      </button>
    );
  if (phase === 'password')
    return (
      <button className="update-btn busy" disabled title="Waiting for the administrator password">
        <span className="update-txt">Waiting for password…</span>
      </button>
    );
  if (phase === 'installing')
    return (
      <button className="update-btn busy" disabled title="Installing the update">
        <span className="update-txt">Installing…</span>
      </button>
    );
  if (phase === 'opened')
    return (
      <span className="update-note" title={kind === 'dmg' ? 'Drag GitHistory to Applications to finish.' : undefined}>
        Update {version} ready
      </span>
    );
  if (phase === 'error' && state.version)
    return (
      <button className="update-btn error" onClick={onApply} title={`${state.error}\n\nClick to try again.`}>
        Update failed — retry
      </button>
    );
  return null;
}
