import { useEffect, useState } from 'react';
export const isDesktop = () => '__TAURI_INTERNALS__' in window;
export async function native<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}
export function DesktopSettings({ onNotice }: { onNotice: (text: string) => void }) {
  const [autoOpen, setAutoOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [top, setTop] = useState(false);
  const [tray, setTray] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void native<{ autoOpen: boolean; focus: boolean; alwaysOnTop: boolean; closeToTray: boolean }>(
      'get_desktop_preferences',
    )
      .then((value) => {
        setAutoOpen(value.autoOpen);
        setFocus(value.focus);
        setTop(value.alwaysOnTop);
        setTray(value.closeToTray);
        setLoaded(true);
      })
      .catch(() => onNotice('Desktop preferences could not be loaded.'));
  }, []);
  async function configure(enabled: boolean, requestedFocus: boolean) {
    try {
      await native('configure_auto_open', { enabled, focus: requestedFocus });
      setAutoOpen(enabled);
      setFocus(requestedFocus);
      onNotice('Auto-open preference saved.');
    } catch {
      onNotice('Could not update the desktop preference.');
    }
  }
  return (
    <div className="desktop-settings">
      <h3>Desktop companion</h3>
      <label className="setting-row">
        Open game when a prompt starts
        <input
          type="checkbox"
          disabled={!loaded}
          checked={autoOpen}
          onChange={(e) => void configure(e.target.checked, focus)}
        />
      </label>
      <label className="setting-row">
        Focus game when opened
        <input
          type="checkbox"
          disabled={!loaded}
          checked={focus}
          onChange={(e) => void configure(autoOpen, e.target.checked)}
        />
      </label>
      <label className="setting-row">
        Keep this window on top
        <input
          type="checkbox"
          disabled={!loaded}
          checked={top}
          onChange={async (e) => {
            const enabled = e.target.checked;
            try {
              await native('set_always_on_top', { enabled });
              setTop(enabled);
            } catch {
              onNotice('Could not change window preference.');
            }
          }}
        />
      </label>
      <label className="setting-row">
        Close to tray instead of quitting
        <input
          type="checkbox"
          disabled={!loaded}
          checked={tray}
          onChange={async (e) => {
            const enabled = e.target.checked;
            try {
              await native('set_close_to_tray', { enabled });
              setTray(enabled);
            } catch {
              onNotice('Could not change close behavior.');
            }
          }}
        />
      </label>
      <h3>Claude Code hooks</h3>
      <p className="muted">
        Installation updates your user Claude settings file (~/.claude/settings.json), preserving existing
        hooks and creating a backup. Clawdash receives lifecycle categories only.
      </p>
      <label className="setting-row">
        <span>I agree to install Clawdash’s Claude hooks</span>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
      </label>
      <div className="button-row">
        <button
          className="secondary"
          disabled={!consent || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await native('manage_hooks', { install: true });
              onNotice('Clawdash hooks installed.');
            } catch {
              onNotice('Hook installation failed. Check the local companion diagnostics.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Install hooks
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await native('manage_hooks', { install: false });
              onNotice('Clawdash hooks removed.');
            } catch {
              onNotice('Hook removal failed. Check the local companion diagnostics.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove Clawdash hooks
        </button>
      </div>
    </div>
  );
}
