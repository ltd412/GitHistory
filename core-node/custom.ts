// Custom command expansion, kept free of Electron so it can be unit-tested.

/** POSIX sh: single quotes are literal; a quote inside is closed, escaped and reopened. */
export const shellQuote = (v: unknown) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/** PowerShell: single-quoted strings are literal; a quote inside is doubled. */
export const powershellQuote = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

/**
 * Replaces ${repo} ${sha} ${branch} ${file} ${head} with quoted values for the shell that will run the
 * command, so a branch or file name can never inject extra shell syntax. Unknown or empty variables are
 * left as-is.
 */
export function expandCommand(template: string, vars: Record<string, unknown>, quote: (v: unknown) => string = shellQuote) {
  return template.replace(/\$\{(\w+)\}/g, (m: string, k: string) => (vars[k] != null ? quote(vars[k]) : m));
}
