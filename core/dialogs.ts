// Dialog contracts the shared actions use (core/actions.ts). Each app renders them its own way: DOM
// overlays on desktop, React Native modals in the Paseo plugin.

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'checkbox' | 'select' | 'time' | 'radio';
  value?: string | boolean;
  options?: { value: string; label: string; description?: string }[];
  placeholder?: string;
}

export interface FormSpec {
  title: string;
  message?: string;
  fields: Field[];
  confirm?: string;
  danger?: boolean;
  wide?: boolean;
}

export type ToastKind = 'info' | 'error' | 'success';

/** The dialogs an action may open. `form` resolves null when cancelled. */
export interface DialogApi {
  form: (req: FormSpec) => Promise<Record<string, any> | null>;
  confirm: (title: string, message: string, opts?: { danger?: boolean; confirm?: string }) => Promise<boolean>;
  toast: (kind: ToastKind, title: string, body?: string) => void;
}
