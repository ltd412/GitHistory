// Asks for the administrator password the updater needs to run `sudo dpkg -i` (Ubuntu / Debian .deb installs).
// The password is handed to the main process, which writes it to sudo's stdin; it is never stored or logged.
import { useState } from 'react';
import { Modal } from './Overlays';

export function PasswordPrompt({ version, wrong, onSubmit, onCancel }: { version?: string; wrong?: boolean; onSubmit: (password: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const submit = () => password && onSubmit(password);
  return (
    <Modal
      title="Administrator password"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn green" disabled={!password} onClick={submit}>
            Install update
          </button>
        </>
      }
    >
      <div className="msg">
        Installing GitHistory {version} needs administrator rights: it runs <code>sudo dpkg -i</code>. The password is sent to sudo only and is not saved.
      </div>
      <label className="f">
        Password
        <input
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      {wrong && <div style={{ color: 'var(--red)', marginTop: 8 }}>Incorrect password — try again.</div>}
    </Modal>
  );
}
