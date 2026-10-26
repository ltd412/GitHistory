import { useEffect, useState } from 'react';
import { errorMessage, git } from '../lib/api';
import { IconArrowDown, IconArrowUp } from './Icons';
import { Modal } from './Overlays';
import { useRepo } from './RepoContext';

type Action = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';
interface Step {
  hash: string;
  subject: string;
  action: Action;
  message: string;
}

export function RebaseDialog({ base, onClose }: { base: string | null; onClose: () => void }) {
  const { repo, data, actions: a } = useRepo();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    git
      .rebaseCommits(repo, base)
      .then((cs) => setSteps(cs.map((c) => ({ hash: c.hash, subject: c.subject, action: 'pick', message: c.subject }))))
      .catch((e) => setError(errorMessage(e)));
  }, [repo, base]);

  const update = (i: number, patch: Partial<Step>) => setSteps((s) => s!.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const n = [...s!];
      const j = i + d;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const kept = steps?.filter((s) => s.action !== 'drop') ?? [];
  const invalid = kept.length > 0 && (kept[0].action === 'squash' || kept[0].action === 'fixup');
  const wip = data.status.staged.length + data.status.unstaged.filter((f) => !f.untracked).length;

  const start = async () => {
    if (!steps) return;
    onClose();
    // WHY: steps carry full messages so reword needs no editor; see interactiveRebase in core-node/git.ts.
    await a.run('Interactive rebase', () => git.interactiveRebase(repo, base, steps.map((s) => ({ action: s.action, hash: s.hash, message: s.message }))), {
      success: 'Rebase complete',
    });
  };

  return (
    <Modal
      title={`Interactive rebase ${data.refs.head ?? 'HEAD'} onto ${base ? (base.length === 40 ? base.slice(0, 7) : base) : 'root'}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn green" disabled={!steps?.length || invalid || wip > 0} onClick={start}>
            Start rebase
          </button>
        </>
      }
    >
      {error && <div className="msg" style={{ color: 'var(--red)' }}>{error}</div>}
      {wip > 0 && <div className="msg" style={{ color: 'var(--orange)' }}>Commit or stash your changes before rebasing.</div>}
      {invalid && <div className="msg" style={{ color: 'var(--orange)' }}>The first commit cannot be squashed or fixed up — there is nothing before it to combine into.</div>}
      <div className="msg">Commits are applied top to bottom. Squash/fixup combine a commit into the one above it.</div>
      {steps?.length === 0 && <div className="msg">No commits to rebase.</div>}
      <div>
        {steps?.map((s, i) => (
          <div key={s.hash}>
            <div className={`rebase-row${s.action === 'drop' ? ' drop' : ''}`}>
              <select className="input" value={s.action} onChange={(e) => update(i, { action: e.target.value as Action })}>
                <option value="pick">Pick</option>
                <option value="reword">Reword</option>
                <option value="squash">Squash</option>
                <option value="fixup">Fixup</option>
                <option value="drop">Drop</option>
              </select>
              <code>{s.hash.slice(0, 7)}</code>
              <span className="s">{s.subject}</span>
              <button className="btn ghost" disabled={i === 0} onClick={() => move(i, -1)}>
                <IconArrowUp />
              </button>
              <button className="btn ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                <IconArrowDown />
              </button>
            </div>
            {s.action === 'reword' && (
              <textarea className="textarea" style={{ margin: '4px 0 8px' }} value={s.message} onChange={(e) => update(i, { message: e.target.value })} />
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
