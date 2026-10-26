// Fallback bridge used when the renderer runs in a plain browser (see scripts/web-bridge.cjs).
// In Electron the preload script defines window.bridge first and this module does nothing.
export function installWebBridge() {
  if (window.bridge) return;
  const call = async (channel: 'git' | 'app', method: string, args: unknown[]) => {
    const res = await fetch('/', { method: 'POST', body: JSON.stringify({ channel, method, args }) });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.result;
  };
  const noop = () => () => {};
  window.bridge = {
    git: (method, ...args) => call('git', method, args),
    app: (method, ...args) => call('app', method, args),
    onRepoChanged: noop,
    onProgress: noop,
    onMenu: noop,
  };
}
