// React Native rendering of the dialogs the shared actions open (core/dialogs.ts), plus the row/ref menus
// (core/menus.ts) and the searchable picker. One provider per project tab.
import { Icon, Modal, TextInput, useToast } from "./sdk";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import type { DialogApi, Field, FormSpec } from "../../shared/core/dialogs";
import type { MenuItem } from "../../shared/core/menus";
import { active, type Tokens } from "../theme";

export interface PaletteItem {
  label: string;
  hint?: string;
  run: () => void;
}

export interface UiApi extends DialogApi {
  menu: (items: MenuItem[], title?: string) => void;
  palette: (items: PaletteItem[], placeholder: string) => void;
}

const Ctx = createContext<UiApi>(null as unknown as UiApi);
export const useUi = () => useContext(Ctx);
/** Re-provides the dialogs inside content Paseo renders elsewhere (its Modal is a portal). */
export const UiProvider = Ctx.Provider;

type Open =
  | { kind: "form"; spec: FormSpec; resolve: (v: Record<string, any> | null) => void }
  | { kind: "menu"; title: string; stack: { title: string; items: MenuItem[] }[] }
  | { kind: "palette"; items: PaletteItem[]; placeholder: string }
  | null;

export function DialogProvider({ t, children }: { t: Tokens; children: ReactNode }) {
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const api = useMemo<UiApi>(
    () => ({
      form: (spec) => new Promise((resolve) => setOpen({ kind: "form", spec, resolve })),
      confirm: (title, message, opts) =>
        new Promise((resolve) =>
          setOpen({
            kind: "form",
            spec: { title, message, fields: [], danger: opts?.danger, confirm: opts?.confirm },
            resolve: (v) => resolve(v != null),
          }),
        ),
      toast: (kind, title, body) =>
        kind === "error" ? toast.error(body ? `${title}: ${body}` : title) : toast.show(body ? `${title} — ${body}` : title, { variant: kind }),
      menu: (items, title = "Actions") => setOpen({ kind: "menu", title, stack: [{ title, items }] }),
      palette: (items, placeholder) => setOpen({ kind: "palette", items, placeholder }),
    }),
    [toast],
  );
  const close = useCallback(() => {
    if (open?.kind === "form") open.resolve(null);
    setOpen(null);
  }, [open]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {open?.kind === "form" && (
        <FormDialog
          t={t}
          spec={open.spec}
          onCancel={close}
          onSubmit={(v) => {
            open.resolve(v);
            setOpen(null);
          }}
        />
      )}
      {open?.kind === "menu" && <MenuDialog t={t} stack={open.stack} setStack={(stack) => setOpen({ ...open, stack })} onClose={close} />}
      {open?.kind === "palette" && <PaletteDialog t={t} items={open.items} placeholder={open.placeholder} onClose={close} />}
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------- form

function FormDialog({ t, spec, onSubmit, onCancel }: { t: Tokens; spec: FormSpec; onSubmit: (v: Record<string, any>) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(spec.fields.map((f) => [f.name, f.value ?? (f.type === "checkbox" ? false : "")])),
  );
  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));
  return (
    <Modal title={spec.title} open onOpenChange={(o) => !o && onCancel()}>
      <Modal.Content>
        {spec.message ? <Text style={{ color: t.text, fontSize: 13, lineHeight: 19 }}>{spec.message}</Text> : null}
        {spec.fields.map((f) => (
          <FieldInput key={f.name} t={t} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} onSubmit={() => onSubmit(values)} />
        ))}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Button t={t} label="Cancel" onPress={onCancel} />
          <Button t={t} label={spec.confirm ?? "OK"} kind={spec.danger ? "danger" : "primary"} onPress={() => onSubmit(values)} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function FieldInput({ t, field: f, value, onChange, onSubmit }: { t: Tokens; field: Field; value: any; onChange: (v: unknown) => void; onSubmit: () => void }) {
  const label = <Text style={{ color: t.dim, fontSize: 12, marginBottom: 4 }}>{f.label}</Text>;
  if (f.type === "checkbox")
    return (
      <Pressable onPress={() => onChange(!value)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Switch value={!!value} onValueChange={onChange} />
        <Text style={{ color: t.text, fontSize: 13, flex: 1 }}>{f.label}</Text>
      </Pressable>
    );
  if (f.type === "radio" || f.type === "select")
    return (
      <View>
        {label}
        <View style={{ borderWidth: 1, borderColor: t.border, borderRadius: 6, overflow: "hidden" }}>
          {(f.options ?? []).map((o, i) => {
            const on = value === o.value;
            return (
              <Pressable
                key={o.value}
                onPress={() => onChange(o.value)}
                style={{ flexDirection: "row", gap: 10, padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.border, backgroundColor: on ? t.select : "transparent" }}
              >
                <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: on ? t.accent : t.dim, alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  {on && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.accent }} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontSize: 13, fontWeight: on ? "600" : "400" }}>{o.label}</Text>
                  {o.description ? <Text style={{ color: t.dim, fontSize: 12, marginTop: 2 }}>{o.description}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  return (
    <View>
      {label}
      <TextInput
        value={String(value ?? "")}
        onChangeText={onChange}
        placeholder={f.placeholder}
        multiline={f.type === "textarea"}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        onSubmitEditing={f.type === "textarea" ? undefined : onSubmit}
        style={{
          color: t.text,
          backgroundColor: t.input,
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 6,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 13,
          minHeight: f.type === "textarea" ? 120 : undefined,
          textAlignVertical: f.type === "textarea" ? "top" : "center",
        }}
      />
    </View>
  );
}

export function Button({ t, label, onPress, kind = "default", disabled, icon }: { t: Tokens; label: string; onPress: () => void; kind?: "default" | "primary" | "danger" | "green"; disabled?: boolean; icon?: string }) {
  const bg = kind === "primary" ? t.accent : kind === "danger" ? t.red : kind === "green" ? t.green : t.panel2;
  const fg = kind === "default" ? t.text : "#fff";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={(st) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 5, backgroundColor: kind === "default" && active(st) && !disabled ? t.hover : bg, opacity: disabled ? 0.45 : st.pressed ? 0.75 : active(st) && kind !== "default" ? 0.88 : 1, borderWidth: kind === "default" ? 1 : 0, borderColor: t.border })}
    >
      {icon ? <Icon name={icon} size={13} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- menu

function MenuDialog({ t, stack, setStack, onClose }: { t: Tokens; stack: { title: string; items: MenuItem[] }[]; setStack: (s: { title: string; items: MenuItem[] }[]) => void; onClose: () => void }) {
  const top = stack[stack.length - 1];
  return (
    <Modal title={top.title} open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content contentContainerStyle={{ padding: 0, gap: 0 }}>
        {stack.length > 1 && (
          <Pressable onPress={() => setStack(stack.slice(0, -1))} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
            <Icon name="ChevronLeft" size={14} color={t.dim} />
            <Text style={{ color: t.dim, fontSize: 13 }}>{stack[stack.length - 2].title}</Text>
          </Pressable>
        )}
        {top.items.map((it, i) => {
          if ("separator" in it) return <View key={i} style={{ height: 1, backgroundColor: t.border, marginVertical: 4 }} />;
          if ("header" in it)
            return (
              <Text key={i} style={{ color: t.faint, fontSize: 11, fontWeight: "700", textTransform: "uppercase", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                {it.header}
              </Text>
            );
          if ("submenu" in it)
            return (
              <Pressable key={i} onPress={() => setStack([...stack, { title: it.label, items: it.submenu }])} style={(st) => rowStyle(t, active(st))}>
                <Text style={{ color: t.text, fontSize: 14, flex: 1 }}>{it.label}</Text>
                <Icon name="ChevronRight" size={14} color={t.dim} />
              </Pressable>
            );
          return (
            <Pressable
              key={i}
              disabled={it.disabled}
              onPress={() => {
                onClose();
                it.onClick();
              }}
              style={(st) => [rowStyle(t, active(st)), { opacity: it.disabled ? 0.4 : 1 }]}
            >
              <Text style={{ color: it.danger ? t.red : t.text, fontSize: 14, flex: 1 }}>{it.label}</Text>
              {it.hint ? <Text style={{ color: t.faint, fontSize: 12 }}>{it.hint}</Text> : null}
            </Pressable>
          );
        })}
      </Modal.Content>
    </Modal>
  );
}

const rowStyle = (t: Tokens, on: boolean) => ({
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 8,
  paddingHorizontal: 16,
  paddingVertical: 11,
  backgroundColor: on ? t.hover : "transparent",
});

// ---------------------------------------------------------------- palette

function PaletteDialog({ t, items, placeholder, onClose }: { t: Tokens; items: PaletteItem[]; placeholder: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter((i) => i.label.toLowerCase().includes(s) || i.hint?.toLowerCase().includes(s)) : items).slice(0, 300);
  }, [q, items]);
  const first = useRef<PaletteItem | undefined>(undefined);
  first.current = shown[0];
  return (
    <Modal title={placeholder} open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
        <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Type to filter"
            onSubmitEditing={() => {
              const it = first.current;
              if (it) {
                onClose();
                it.run();
              }
            }}
            style={{ color: t.text, backgroundColor: t.input, borderWidth: 1, borderColor: t.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 }}
          />
        </View>
        <ScrollView style={{ maxHeight: 420 }}>
          {shown.map((it, i) => (
            <Pressable
              key={i}
              onPress={() => {
                onClose();
                it.run();
              }}
              style={(st) => rowStyle(t, active(st))}
            >
              <Text style={{ color: t.text, fontSize: 13, flex: 1 }} numberOfLines={1}>
                {it.label}
              </Text>
              {it.hint ? <Text style={{ color: t.faint, fontSize: 11 }}>{it.hint}</Text> : null}
            </Pressable>
          ))}
          {!shown.length && <Text style={{ color: t.dim, padding: 16 }}>No matches</Text>}
        </ScrollView>
      </Modal.Content>
    </Modal>
  );
}
