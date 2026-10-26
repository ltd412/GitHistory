import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconX } from './Icons';
import type { MenuItem } from '../lib/menus';
import type { DialogApi, Field, FormSpec, ToastKind } from '../lib/dialogs';
import { keyLabel } from '../lib/keys';

// ---------------------------------------------------------------- types

export type { MenuItem };

export type { Field };

interface FormRequest extends FormSpec {
  resolve: (v: Record<string, any> | null) => void;
}

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
}

interface UI extends DialogApi {
  menu: (e: { clientX: number; clientY: number }, items: MenuItem[]) => void;
}

const Ctx = createContext<UI>(null as unknown as UI);
export const useUI = () => useContext(Ctx);

// ---------------------------------------------------------------- provider

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [form, setForm] = useState<FormRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const ui: UI = {
    menu: useCallback((e, items) => setMenu({ x: e.clientX, y: e.clientY, items }), []),
    form: useCallback((req) => new Promise((resolve) => setForm({ ...req, resolve })), []),
    confirm: useCallback(
      (title, message, opts) =>
        new Promise<boolean>((resolve) =>
          setForm({
            title,
            message,
            fields: [],
            danger: opts?.danger,
            confirm: opts?.confirm,
            resolve: (v) => resolve(v != null),
          }),
        ),
      [],
    ),
    toast: useCallback((kind, title, body) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-4), { id, kind, title, body }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 12000 : 4000);
    }, []),
  };

  return (
    <Ctx.Provider value={ui}>
      {children}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {form && (
        <FormDialog
          req={form}
          onDone={(v) => {
            form.resolve(v);
            setForm(null);
          }}
        />
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div className="body">
              <b>{keyLabel(t.title)}</b>
              {t.body && keyLabel(t.body)}
            </div>
            <span className="x" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              <IconX width={12} height={12} />
            </span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------- context menu

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Submenus render inside the root element, so one containment check covers every level.
    const close = (e: Event) => {
      if (root.current && e.target instanceof Node && root.current.contains(e.target)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', onClose);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  return (
    <div ref={root}>
      <MenuList x={x} y={y} items={items} onClose={onClose} />
    </div>
  );
}

/** One menu level; a submenu opens beside its item on hover and flips left at the screen edge. */
function MenuList({ x, y, items, onClose, flipLeftOf }: { x: number; y: number; items: MenuItem[]; onClose: () => void; flipLeftOf?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<{ i: number; x: number; y: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const overflowsRight = x + r.width > window.innerWidth - 6;
    setPos({
      x: overflowsRight ? (flipLeftOf != null ? Math.max(6, flipLeftOf - r.width + 2) : window.innerWidth - r.width - 6) : x,
      y: Math.max(6, Math.min(y, window.innerHeight - r.height - 6)),
    });
  }, [x, y, flipLeftOf]);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => {
        if ('separator' in it) return <div key={i} className="ctx-sep" />;
        if ('header' in it) return <div key={i} className="ctx-header">{it.header}</div>;
        if ('submenu' in it)
          return (
            <div
              key={i}
              className={`ctx-item has-sub${open?.i === i ? ' open' : ''}`}
              onMouseEnter={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setOpen({ i, x: r.right - 2, y: r.top - 4, left: r.left });
              }}
            >
              {it.label}
              <span className="hint">▸</span>
            </div>
          );
        return (
          <div
            key={i}
            className={`ctx-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}`}
            onMouseEnter={() => setOpen(null)}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onClick();
            }}
          >
            {it.label}
            {it.hint && <span className="hint">{it.hint}</span>}
          </div>
        );
      })}
      {open && 'submenu' in items[open.i] && (
        <MenuList x={open.x} y={open.y} items={(items[open.i] as { submenu: MenuItem[] }).submenu} onClose={onClose} flipLeftOf={open.left} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- form dialog

function FormDialog({ req, onDone }: { req: FormRequest; onDone: (v: Record<string, any> | null) => void }) {
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(req.fields.map((f) => [f.name, f.value ?? (f.type === 'checkbox' ? false : '')])),
  );
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
    if (firstRef.current instanceof HTMLInputElement) firstRef.current.select();
  }, []);
  const submit = () => onDone(values);
  const set = (k: string, v: any) => setValues((s) => ({ ...s, [k]: v }));
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form
        className={`modal${req.wide ? ' wide' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.key === 'Escape' && onDone(null)}
      >
        <div className="modal-title">{req.title}</div>
        <div className="modal-body">
          {req.message && <div className="msg">{req.message}</div>}
          {req.fields.map((f, i) => {
            const refProp = i === 0 ? { ref: (el: any) => (firstRef.current = el) } : {};
            if (f.type === 'radio')
              // All choices visible at once, each with a one-line explanation (no dropdown to open).
              return (
                <div key={f.name} className="radio-group" role="radiogroup" aria-label={f.label}>
                  <div className="radio-title">{f.label}</div>
                  {f.options!.map((o) => (
                    <label key={o.value} className={`radio-opt${values[f.name] === o.value ? ' on' : ''}`}>
                      <input type="radio" name={f.name} checked={values[f.name] === o.value} onChange={() => set(f.name, o.value)} />
                      <span>
                        <b>{o.label}</b>
                        {o.description && <small>{o.description}</small>}
                      </span>
                    </label>
                  ))}
                </div>
              );
            if (f.type === 'checkbox')
              return (
                <label key={f.name} className="toggle-check">
                  <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
                  {f.label}
                </label>
              );
            return (
              <label key={f.name} className="f">
                {f.label}
                {f.type === 'textarea' ? (
                  <textarea
                    {...refProp}
                    className="textarea"
                    value={values[f.name]}
                    placeholder={f.placeholder}
                    onChange={(e) => set(f.name, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
                  />
                ) : f.type === 'select' ? (
                  <select className="input" value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                    {f.options!.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...refProp}
                    className="input"
                    type={f.type === 'time' ? 'time' : 'text'}
                    value={values[f.name]}
                    placeholder={f.placeholder}
                    onChange={(e) => set(f.name, e.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button type="submit" className={`btn ${req.danger ? 'red' : 'green'}`} autoFocus={req.fields.length === 0}>
            {req.confirm ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A modal shell for custom dialogs (rebase, settings, clone). */
export function Modal({
  title,
  wide,
  onClose,
  children,
  footer,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
