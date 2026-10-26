import { useCallback, useEffect, useMemo, useState } from 'react';
import { app } from './lib/api';
import { basename } from './lib/format';
import type { Settings } from './lib/types';
import { IconFolder, IconMoon, IconPlus, IconSun, IconX } from './components/Icons';
import { effectiveTheme, isValidTime } from './lib/theme';
import { setLanePalette } from './lib/format';
import { OverlayProvider, useUI } from './components/Overlays';
import { RepoView } from './components/RepoView';
import { CloneDialog, InitDialog, Palette, SettingsDialog, type PaletteItem } from './components/Dialogs';
import { RepoManager } from './components/RepoManager';
import { IS_MAC, keyLabel } from './lib/keys';

interface Tab {
  id: number;
  repo: string | null;
}

let nextTabId = 1;

export function App() {
  return (
    <OverlayProvider>
      <Shell />
    </OverlayProvider>
  );
}

function Shell() {
  const ui = useUI();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState(0);
  const [dialog, setDialog] = useState<'clone' | 'init' | 'prefs' | null>(null);
  const [menuCommand, setMenuCommand] = useState<{ cmd: string; seq: number } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Restore the tabs that were open last time.
  useEffect(() => {
    void (async () => {
      const s = await app.getSettings();
      setSettings(s);
      const restored: Tab[] = [];
      for (const r of s.openTabs) {
        const top = await app.openRepo(r).catch(() => null);
        if (top) restored.push({ id: nextTabId++, repo: top });
      }
      const initial = await app.initialRepo();
      const initialTop = initial ? await app.openRepo(initial).catch(() => null) : null;
      if (initialTop && !restored.some((t) => t.repo === initialTop)) restored.push({ id: nextTabId++, repo: initialTop });
      if (!restored.length) restored.push({ id: nextTabId++, repo: null });
      setTabs(restored);
      const active = restored.find((t) => t.repo === (initialTop ?? s.activeTab)) ?? restored[0];
      setActiveId(active.id);
    })();
  }, []);

  useEffect(() => {
    if (!settings || !tabs.length) return;
    const openTabs = tabs.map((t) => t.repo).filter((r): r is string => !!r);
    const activeTab = tabs.find((t) => t.id === activeId)?.repo ?? null;
    void app.setSettings({ openTabs, activeTab });
  }, [tabs, activeId, settings]);

  const active = tabs.find((t) => t.id === activeId);

  // ------------------------------------------------------------ theme
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    // Re-evaluated every 30 s so the time-of-day schedule flips on time.
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => {
      mq.removeEventListener('change', onChange);
      clearInterval(t);
    };
  }, []);
  const theme = settings
    ? effectiveTheme(settings.theme ?? 'dark', { systemDark, now: clock, lightFrom: settings.lightFrom ?? '06:00', darkFrom: settings.darkFrom ?? '18:00' })
    : 'dark';
  // Lane colours are read during render, so the palette switches before children re-render.
  setLanePalette(theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    void app.setNativeTheme(theme);
  }, [theme]);

  const themeMenu = (e: React.MouseEvent) => {
    if (!settings) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mark = (m: string) => (settings.theme === m ? '✓  ' : '     ');
    ui.menu({ clientX: r.left, clientY: r.bottom + 4 }, [
      { header: 'Appearance' },
      { label: `${mark('dark')}Dark`, onClick: () => void onSettings({ theme: 'dark' }) },
      { label: `${mark('light')}Light`, onClick: () => void onSettings({ theme: 'light' }) },
      { label: `${mark('system')}Match macOS`, onClick: () => void onSettings({ theme: 'system' }) },
      {
        label: `${mark('schedule')}Auto by time — light ${settings.lightFrom ?? '06:00'} → dark ${settings.darkFrom ?? '18:00'}`,
        onClick: () => void onSettings({ theme: 'schedule' }),
      },
      { separator: true },
      { label: 'Set light/dark hours…', onClick: () => void editSchedule() },
    ]);
  };
  const editSchedule = async () => {
    if (!settings) return;
    const v = await ui.form({
      title: 'Auto theme by time of day',
      message: 'The light theme is used from the first time until the second; dark the rest of the day. Times may wrap past midnight.',
      fields: [
        { name: 'lightFrom', label: 'Light from', type: 'time', value: settings.lightFrom ?? '06:00' },
        { name: 'darkFrom', label: 'Dark from', type: 'time', value: settings.darkFrom ?? '18:00' },
      ],
      confirm: 'Use this schedule',
    });
    if (!v) return;
    if (!isValidTime(v.lightFrom) || !isValidTime(v.darkFrom)) return ui.toast('error', 'Invalid time', 'Use HH:MM, e.g. 06:30.');
    void onSettings({ theme: 'schedule', lightFrom: v.lightFrom, darkFrom: v.darkFrom });
  };

  const openInTab = useCallback(
    (repo: string) => {
      const existing = tabs.find((t) => t.repo === repo);
      if (existing) return setActiveId(existing.id);
      setTabs((ts) => {
        const cur = ts.find((t) => t.id === activeId);
        // Reuse the current tab when it is an empty "new tab" page.
        if (cur && !cur.repo) return ts.map((t) => (t.id === cur.id ? { ...t, repo } : t));
        const tab = { id: nextTabId++, repo };
        setActiveId(tab.id);
        return [...ts, tab];
      });
      void app.getSettings().then(setSettings);
    },
    [tabs, activeId],
  );

  const openRepo = useCallback(
    async (dir?: string) => {
      const picked = dir ?? (await app.pickDirectory());
      if (!picked) return;
      const repo = await app.openRepo(picked);
      if (!repo) return ui.toast('error', 'Not a Git repository', picked);
      openInTab(repo);
    },
    [ui, openInTab],
  );

  const onSettings = useCallback(async (patch: Partial<Settings>) => setSettings(await app.setSettings(patch)), []);

  // Quick Launch: every known repository, reachable from ⌘P in any tab.
  const repoItems = useMemo<PaletteItem[]>(() => {
    if (!settings) return [];
    const paths = [...new Set([...settings.repos.map((r) => r.path), ...settings.recent])];
    return [
      ...paths.map((p) => ({ label: `Open repository: ${basename(p)}`, hint: p.replace(/^\/Users\/[^/]+/, '~'), run: () => void openRepo(p) })),
      { label: 'Repository Manager', hint: '⇧⌘R', run: () => newTab() },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.repos, settings?.recent, openRepo]);

  const newTab = () => {
    const tab = { id: nextTabId++, repo: null };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  };

  const closeTab = (id: number) => {
    setTabs((ts) => {
      const t = ts.find((x) => x.id === id);
      if (t?.repo && !ts.some((x) => x.id !== id && x.repo === t.repo)) void app.closeRepo(t.repo);
      let rest = ts.filter((x) => x.id !== id);
      if (!rest.length) rest = [{ id: nextTabId++, repo: null }];
      if (id === activeId) {
        const i = ts.findIndex((x) => x.id === id);
        setActiveId((rest[Math.min(i, rest.length - 1)] ?? rest[0]).id);
      }
      return rest;
    });
  };

  useEffect(
    () =>
      app.onMenu((cmd) => {
        if (cmd === 'open') return void openRepo();
        if (cmd === 'clone') return setDialog('clone');
        if (cmd === 'init') return setDialog('init');
        if (cmd === 'preferences') return setDialog('prefs');
        if (cmd === 'newTab') return newTab();
        if (cmd === 'closeTab') return closeTab(activeId);
        if (cmd === 'repoManager') return newTab();
        if (cmd === 'compact' && !tabs.find((t) => t.id === activeId)?.repo) return void onSettings({ compact: !settings?.compact });
        if (cmd === 'palette' && !tabs.find((t) => t.id === activeId)?.repo) return setPaletteOpen(true);
        setMenuCommand((m) => ({ cmd, seq: (m?.seq ?? 0) + 1 }));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openRepo, activeId, tabs, settings?.compact],
  );

  if (!settings) return <div className="app" />;

  return (
    <div className="app">
      <div className={`tabbar${IS_MAC ? ' mac' : ''}`}>
        {tabs.map((t) => (
          <div key={t.id} className={`tab${t.id === activeId ? ' active' : ''}`} onClick={() => setActiveId(t.id)} title={t.repo ?? 'New tab'} onAuxClick={(e) => e.button === 1 && closeTab(t.id)}>
            <IconFolder width={13} height={13} />
            <span className="name">{t.repo ? basename(t.repo) : 'New Tab'}</span>
            <span
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              <IconX width={10} height={10} />
            </span>
          </div>
        ))}
        <div className="tab-add" onClick={newTab} title={keyLabel('New tab (⌘T)')}>
          <IconPlus width={14} height={14} />
        </div>
        <div className="theme-btn" onClick={themeMenu} title="Appearance: dark / light / match macOS / auto by time">
          {theme === 'light' ? <IconSun /> : <IconMoon />}
          {settings.theme === 'schedule' ? 'Auto' : settings.theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}
        </div>
      </div>
      {tabs.map((t) =>
        t.repo ? (
          <RepoView
            key={t.id}
            repo={t.repo}
            active={t.id === activeId}
            settings={settings}
            menuCommand={menuCommand}
            onAppCommand={(cmd) => (cmd === 'open' ? void openRepo() : setDialog(cmd as 'clone' | 'init' | 'prefs'))}
            onSettings={onSettings}
            extraPalette={repoItems}
          />
        ) : null,
      )}
      {active && !active.repo && (
        <RepoManager settings={settings} onOpen={openRepo} onSettings={onSettings} onClone={() => setDialog('clone')} onInit={() => setDialog('init')} />
      )}
      {dialog === 'clone' && <CloneDialog settings={settings} onClose={() => setDialog(null)} onOpened={openInTab} />}
      {dialog === 'init' && <InitDialog onClose={() => setDialog(null)} onOpened={openInTab} />}
      {paletteOpen && (
        <Palette
          items={[
            ...repoItems,
            { label: 'Open repository…', hint: '⌘O', run: () => void openRepo() },
            { label: 'Clone repository…', hint: '⌘N', run: () => setDialog('clone') },
            { label: 'Init repository…', run: () => setDialog('init') },
            { label: 'Preferences', hint: '⌘,', run: () => setDialog('prefs') },
          ]}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {dialog === 'prefs' && <SettingsDialog repo={active?.repo ?? null} settings={settings} onChange={setSettings} onClose={() => setDialog(null)} />}
    </div>
  );
}
