import { useCallback, useEffect, useRef, useState } from 'react';
import { curatedLevels } from '../../../packages/level-content/src/index';
import { parseLevel, type LevelSpec } from '../../../packages/level-schema/src/index';
import type { RunState } from '../../../packages/game/src/simulation/index';
import { GameHost } from '../../../packages/game/src/renderer/index';
import { loadSave, persist, type Save, type Settings } from './storage';
import { Companion, type Session } from './bridge';
import { enableOffline, disableOffline } from './offline';
import { DesktopSettings, isDesktop, native } from './DesktopSettings';

type Screen = 'home' | 'levels' | 'game' | 'settings' | 'repo';
const descriptions = [
  'A first spark. Find the rhythm, then follow it.',
  'Stay sharp. A little tighter, a little further.',
  'One more try. The city is yours tonight.',
];
const stateLabel: Record<string, string> = {
  idle: 'Agent ready',
  working: 'Agent working',
  attention: 'Needs your attention',
  turn_ended: 'Turn ended',
  error: 'Turn failed',
  ended: 'Session ended',
  unknown: 'Connection lost / unknown',
};
function Logo() {
  return (
    <span className="wordmark">
      <span className="brand-cube" aria-hidden="true">
        ⌁
      </span>
      clawdash<span className="wordmark-dot">.</span>
    </span>
  );
}
function Landscape() {
  return (
    <div className="landscape" aria-hidden="true">
      <div className="sun" />
      <div className="building b1" />
      <div className="building b2" />
      <div className="building b3" />
      <div className="building b4" />
      <div className="building b5" />
      <div className="orbit o1" />
      <div className="orbit o2" />
      <div className="hero-cube">
        <i />
        <i />
        <b />
      </div>
      <div className="hero-trail" />
      <div className="spike s1" />
      <div className="spike s2" />
      <div className="terrain" />
      <span className="coordinate">35.0° N / FLOW STATE</span>
    </div>
  );
}

export function App() {
  const [save, setSave] = useState<Save>();
  const [screen, setScreen] = useState<Screen>('home');
  const [level, setLevel] = useState<LevelSpec>(curatedLevels[0]!);
  const [practice, setPractice] = useState(false);
  const [run, setRun] = useState<RunState>();
  const [paused, setPaused] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [notice, setNotice] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);
  const [companion, setCompanion] = useState<Companion>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const [activeSession, setActiveSession] = useState('');
  const host = useRef<GameHost | undefined>(undefined);
  const mount = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    void loadSave().then(setSave);
    if (isDesktop())
      void native<{ url: string; token: string }>('bridge_connection')
        .then((c) => setCompanion(new Companion(c.url, c.token)))
        .catch(() => setNotice('Desktop companion unavailable. Arcade is ready.'));
  }, []);
  useEffect(() => {
    if (save) void persist(save).then((ok) => setStorageFailed(!ok));
  }, [save]);
  useEffect(() => {
    main.current?.focus();
  }, [screen]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!companion) return;
    let live = true;
    let previous = new Map<string, string>();
    const poll = async () => {
      try {
        const list = await companion.sessions();
        if (!live) return;
        setConnected(true);
        setSessions(list);
        for (const s of list) {
          if (
            previous.has(s.sessionId) &&
            previous.get(s.sessionId) !== s.state &&
            ['attention', 'turn_ended', 'error'].includes(s.state)
          )
            setNotice(stateLabel[s.state] ?? s.state);
        }
        previous = new Map(list.map((s) => [s.sessionId, s.state]));
      } catch {
        if (live) setConnected(false);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [companion]);
  const updateRun = useCallback(
    (state: RunState) => {
      setRun(state);
      if (state.status === 'dead' || state.status === 'completed')
        setSave((current) => {
          if (!current) return current;
          const key = `${level.levelId}:${state.practice ? 'practice' : 'normal'}`;
          const old = current.records[key];
          return {
            ...current,
            lastLevel: level.levelId,
            records: {
              ...current.records,
              [key]: {
                best: Math.max(old?.best ?? 0, state.progress),
                attempts: (old?.attempts ?? 0) + 1,
                completed: !!old?.completed || state.status === 'completed',
                ...(state.status === 'completed'
                  ? { ticks: Math.min(old?.ticks ?? Infinity, state.tick) }
                  : old?.ticks !== undefined
                    ? { ticks: old.ticks }
                    : {}),
              },
            },
          };
        });
    },
    [level],
  );
  useEffect(() => {
    if (screen !== 'game' || !mount.current || !save) return;
    const instance = new GameHost(mount.current, {
      level,
      practice,
      ...save.settings,
      onState: updateRun,
      onPause: () => setPaused(true),
    });
    host.current = instance;
    mount.current.focus();
    return () => {
      instance.destroy();
      host.current = undefined;
    };
    // Settings apply through configure without rebuilding the simulation.
  }, [screen, runKey, level, practice, updateRun]);
  useEffect(() => {
    host.current?.pause(paused);
  }, [paused]);
  useEffect(() => {
    if (save) host.current?.configure(save.settings);
  }, [save?.settings]);
  const setting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSave((current) =>
      current ? { ...current, settings: { ...current.settings, [key]: value } } : current,
    );
  const play = (selected: LevelSpec, mode = practice) => {
    setLevel(selected);
    setPractice(mode);
    setPaused(false);
    setRun(undefined);
    setRunKey((v) => v + 1);
    setScreen('game');
    setSave((current) => (current ? { ...current, lastLevel: selected.levelId } : current));
  };
  const retry = () => {
    setPaused(false);
    host.current?.retry();
    host.current?.pause(false);
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice('Fullscreen is unavailable in this window.');
    }
  };
  const windowMode = async (mode: 'compact' | 'normal') => {
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_window_mode', { mode });
      } else setNotice('Resize your browser to play compact. The game fits windows as small as 480 × 270.');
    } catch {
      setNotice('Window mode could not be changed.');
    }
  };
  if (!save)
    return (
      <div className="loading">
        <Logo />
        <span>Warming up the signal…</span>
      </div>
    );
  const selectedSession = sessions.find((s) => s.sessionId === activeSession) ?? sessions[0];
  const agentText = !connected
    ? 'Companion disconnected'
    : selectedSession
      ? Date.now() - Date.parse(selectedSession.lastSeenAt) > 120000 && selectedSession.state === 'working'
        ? 'Connection lost / unknown'
        : (stateLabel[selectedSession.state] ?? 'Agent ready')
      : 'Waiting for agent';
  const best = save.records[`${level.levelId}:${practice ? 'practice' : 'normal'}`]?.best ?? 0;
  return (
    <div
      className={`app theme-${save.settings.theme} ${save.settings.reducedMotion ? 'reduced-motion' : ''} ${screen === 'game' ? 'in-game' : ''}`}
    >
      {screen !== 'game' && (
        <header className="header">
          <button className="logo-button" onClick={() => setScreen('home')} aria-label="Clawdash home">
            <Logo />
          </button>
          <div className="header-right">
            <span className="local-status">
              <i />
              ALL LOCAL. ALL YOURS.
            </span>
            <button className="icon-button" onClick={() => setScreen('settings')} aria-label="Settings">
              ⚙
            </button>
          </div>
        </header>
      )}
      <main ref={main} tabIndex={-1}>
        {screen === 'home' && (
          <section className="home">
            <div className="hero-copy">
              <div className="eyebrow">
                <span /> A LITTLE FLOW BETWEEN THE WORK
              </div>
              <h1>
                Less waiting.
                <br />
                <em>More playing.</em>
              </h1>
              <p>
                Your next jump is closer than you think.
                <br />
                An offline arcade for the in-between.
              </p>
              <button className="primary play-main" onClick={() => setScreen('levels')}>
                Let’s play <span>↗</span>
              </button>
              <div className="hero-links">
                <button onClick={() => setScreen('repo')}>⌘ &nbsp; Run your repo</button>
                <span>/</span>
                <button onClick={() => setScreen('repo')}>Connect an agent ↗</button>
              </div>
              {save.lastLevel && curatedLevels.some((l) => l.levelId === save.lastLevel) && (
                <button
                  className="resume-link"
                  onClick={() => play(curatedLevels.find((l) => l.levelId === save.lastLevel) ?? level)}
                >
                  ↺ Return to{' '}
                  {curatedLevels.find((l) => l.levelId === save.lastLevel)?.displayName ?? 'your last run'}
                </button>
              )}
            </div>
            <Landscape />
            <div className="home-footer">
              <span>
                <b>01—03</b> THREE TRACKS. ENDLESS RETRIES.
              </span>
              <span>NO ACCOUNT. NO NETWORK. JUST ONE MORE TRY.</span>
              <span className="version">VOL. 01 / 2026</span>
            </div>
          </section>
        )}
        {screen === 'levels' && (
          <section className="page levels-page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">THE ARCADE / VOL. 01</div>
                <h2>Pick your frequency.</h2>
                <p>One button. A little rhythm. A fresh start every time.</p>
              </div>
              <ModeSwitch practice={practice} onChange={setPractice} />
            </div>
            <div className="level-list">
              {curatedLevels.map((l, index) => {
                const record = save.records[`${l.levelId}:${practice ? 'practice' : 'normal'}`];
                return (
                  <button key={l.levelId} className={`level-card level-${index}`} onClick={() => play(l)}>
                    <div className="level-art" aria-hidden="true">
                      <span className="level-number">0{index + 1}</span>
                      <div className="mini-line" />
                      <div className="mini-cube" />
                      <div className="mini-spikes">△ △ △</div>
                      <span className="level-bpm">{l.bpm} BPM</span>
                    </div>
                    <div className="level-info">
                      <div className="level-meta">
                        <span>{['FIND YOUR FEET', 'FIND YOUR FOCUS', 'FIND YOUR LIMIT'][index]}</span>
                        <span>{Math.round(l.totalTicksEstimate / 60)}s</span>
                      </div>
                      <h3>
                        {l.displayName}
                        <span>↗</span>
                      </h3>
                      <p>{descriptions[index]}</p>
                      <div className="best-line">
                        <span>{record?.completed ? '✓ CLEARED' : 'PERSONAL BEST'}</span>
                        <b>
                          {Math.floor(record?.best ?? 0)}
                          <small>%</small>
                        </b>
                      </div>
                      <div className="best-track">
                        <i style={{ width: `${record?.best ?? 0}%` }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="level-footer">
              <span>
                <kbd>SPACE</kbd> / <kbd>↑</kbd> / TAP TO JUMP · HOLD TO CHAIN
              </span>
              <span>
                {practice
                  ? 'Practice bests stay separate. Press C on safe ground to save a checkpoint.'
                  : 'The only way through is one more try.'}
              </span>
            </div>
          </section>
        )}
        {screen === 'game' && (
          <section
            className="game-screen"
            aria-label={`${level.displayName} ${practice ? 'practice' : 'normal'} run`}
          >
            <div
              className="game-mount"
              ref={mount}
              tabIndex={0}
              aria-label="Game canvas. Space, Up or tap to jump. Escape to pause. R to retry. C sets a practice checkpoint."
            />
            <div className="game-hud">
              <div className="hud-title">
                <b>{level.displayName}</b>
                <span>
                  {practice ? 'PRACTICE' : 'NORMAL'} <i> / </i> ATTEMPT {run?.attempt ?? 1}
                </span>
              </div>
              <div className="hud-progress">
                <b>
                  {Math.floor(run?.progress ?? 0)}
                  <small>%</small>
                </b>
                <div>
                  <i style={{ width: `${run?.progress ?? 0}%` }} />
                </div>
              </div>
              <div className="hud-buttons">
                {practice && (
                  <button
                    className="icon-button"
                    onClick={() => {
                      host.current?.checkpoint();
                      setNotice('Checkpoint requested. Only safe grounded positions are saved.');
                    }}
                    aria-label="Set checkpoint"
                  >
                    ⚑
                  </button>
                )}
                <button
                  className="icon-button"
                  onClick={() => setting('muted', !save.settings.muted)}
                  aria-label={save.settings.muted ? 'Unmute' : 'Mute'}
                >
                  {save.settings.muted ? '♪̸' : '♪'}
                </button>
                <button className="icon-button" onClick={() => setPaused(true)} aria-label="Pause">
                  Ⅱ
                </button>
              </div>
            </div>
            <div className="game-bottom">
              <span>
                BEST {Math.floor(best)}% {run?.checkpoint ? ' · ⚑ CHECKPOINT SAVED' : ''}
              </span>
              {companion && (
                <span className="agent-indicator">
                  <i className={connected ? 'connected' : ''} />
                  {agentText}
                  {sessions.length > 1 ? ` +${sessions.length - 1}` : ''}
                </span>
              )}
              <span className="game-help">SPACE / ↑ / TAP</span>
            </div>
            {(paused || run?.status === 'dead' || run?.status === 'completed') && (
              <div className="overlay">
                <div
                  className="game-dialog"
                  onKeyDown={(event) => {
                    if (event.code === 'KeyR') {
                      event.preventDefault();
                      retry();
                    }
                    if (event.key === 'Escape' && paused) {
                      event.preventDefault();
                      setPaused(false);
                    }
                    if (event.key === 'Tab') {
                      const items = [
                        ...event.currentTarget.querySelectorAll<HTMLElement>(
                          'button:not(:disabled), input, select',
                        ),
                      ];
                      const first = items[0];
                      const last = items.at(-1);
                      if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last?.focus();
                      } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first?.focus();
                      }
                    }
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-label={
                    paused ? 'Paused' : run?.status === 'completed' ? 'Level complete' : 'Try again'
                  }
                >
                  <div className="eyebrow">
                    {paused
                      ? 'TAKE A BREATH'
                      : run?.status === 'completed'
                        ? practice
                          ? 'PRACTICE COMPLETE'
                          : 'FREQUENCY FOUND'
                        : 'YOU’RE GETTING CLOSER'}
                  </div>
                  <h2>
                    {paused
                      ? 'On your time.'
                      : run?.status === 'completed'
                        ? 'Beautiful run.'
                        : 'One more try?'}
                  </h2>
                  <p>
                    {paused
                      ? 'Your next jump will be right here.'
                      : `${Math.floor(run?.progress ?? 0)}% · Attempt ${run?.attempt ?? 1} · ${((run?.tick ?? 0) / 60).toFixed(1)}s`}
                  </p>
                  <div className="dialog-actions">
                    <button autoFocus className="primary" onClick={paused ? () => setPaused(false) : retry}>
                      {paused ? 'Keep going' : 'Run it back'} <span>↗</span>
                    </button>
                    {run?.status === 'completed' && (
                      <button
                        className="secondary"
                        onClick={() =>
                          play(
                            curatedLevels[
                              (curatedLevels.findIndex((l) => l.levelId === level.levelId) + 1) %
                                curatedLevels.length
                            ]!,
                          )
                        }
                      >
                        Next track →
                      </button>
                    )}
                    {paused && (
                      <>
                        <button className="secondary" onClick={retry}>
                          Restart run
                        </button>
                        <button className="text-button" onClick={() => play(level, !practice)}>
                          Switch to {practice ? 'normal' : 'practice'}
                        </button>
                        <label className="pause-audio">
                          Music
                          <input
                            aria-label="Music volume"
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={save.settings.music}
                            onChange={(e) => setting('music', Number(e.target.value))}
                          />
                        </label>
                      </>
                    )}
                    <button
                      className="text-button"
                      onClick={() => {
                        setPaused(false);
                        setScreen('levels');
                      }}
                    >
                      Back to tracks
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
        {screen === 'settings' && (
          <section className="page settings-page">
            <div className="eyebrow">MAKE YOURSELF AT HOME</div>
            <h2>Your kind of flow.</h2>
            <div className="settings-grid">
              <div>
                <h3>Sound & feeling</h3>
                <label className="setting-row">
                  Music{' '}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={save.settings.music}
                    onChange={(e) => setting('music', Number(e.target.value))}
                  />
                </label>
                <label className="setting-row">
                  Sound effects{' '}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={save.settings.sfx}
                    onChange={(e) => setting('sfx', Number(e.target.value))}
                  />
                </label>
                <Toggle
                  label="Mute all audio"
                  value={save.settings.muted}
                  onChange={(v) => setting('muted', v)}
                />
                <Toggle
                  label="Reduced motion"
                  description="Less rotation and trailing effects."
                  value={save.settings.reducedMotion}
                  onChange={(v) => setting('reducedMotion', v)}
                />
                <h3>Choose a signal</h3>
                <div className="theme-picker">
                  {(['signal', 'glacier', 'ember'] as const).map((t) => (
                    <button
                      key={t}
                      className={`theme-option ${t} ${save.settings.theme === t ? 'selected' : ''}`}
                      aria-pressed={save.settings.theme === t}
                      onClick={() => setting('theme', t)}
                    >
                      <i />
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h3>Make some room</h3>
                <div className="button-row">
                  <button className="secondary" onClick={() => void fullscreen()}>
                    Fullscreen ↗
                  </button>
                  <button className="secondary" onClick={() => void windowMode('compact')}>
                    Compact
                  </button>
                  <button className="text-button" onClick={() => void windowMode('normal')}>
                    Normal
                  </button>
                </div>
                <h3>Take it offline</h3>
                <p className="muted">
                  Install the game’s files on this device. Arcade keeps playing when your connection takes a
                  break.
                </p>
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      if (save.settings.offline) {
                        await disableOffline();
                        setting('offline', false);
                        setNotice('Offline cache removed. Your bests are still saved.');
                      } else {
                        await enableOffline();
                        setting('offline', true);
                        setNotice('Offline ready. All three tracks are saved on this device.');
                      }
                    } catch (e) {
                      setNotice(e instanceof Error ? e.message : 'Offline installation failed');
                    }
                  }}
                >
                  {save.settings.offline ? 'Remove offline files' : 'Install for offline play'}
                </button>
                <h3>Your controls</h3>
                <p className="controls">
                  <kbd>SPACE</kbd> <kbd>↑</kbd> Jump · hold to chain
                  <br />
                  <kbd>ESC</kbd> Pause &nbsp; <kbd>R</kbd> Retry &nbsp; <kbd>C</kbd> Checkpoint
                  <br />
                  Touch or click the playfield to jump.
                </p>
                <p className="muted small">
                  Original locally synthesized music. Your settings and normal/practice bests are stored on
                  this device.
                </p>
                {isDesktop() && <DesktopSettings onNotice={setNotice} />}
              </div>
            </div>
            <button className="text-button back" onClick={() => setScreen('home')}>
              ← Back home
            </button>
          </section>
        )}
        {screen === 'repo' && (
          <CompanionPage
            companion={companion}
            connected={connected}
            sessions={sessions}
            activeSession={activeSession}
            onSelectSession={setActiveSession}
            onConnect={setCompanion}
            onPlay={(l) => play(l, false)}
            onNotice={setNotice}
          />
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => setNotice('')} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
      {storageFailed && (
        <div className="storage-warning" role="status">
          Storage is unavailable. Bests will last for this visit.
        </div>
      )}
    </div>
  );
}
function ModeSwitch({ practice, onChange }: { practice: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="mode-switch" aria-label="Run mode">
      <button
        aria-pressed={!practice}
        className={!practice ? 'selected' : ''}
        onClick={() => onChange(false)}
      >
        Normal
      </button>
      <button aria-pressed={practice} className={practice ? 'selected' : ''} onClick={() => onChange(true)}>
        Practice
      </button>
    </div>
  );
}
function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="setting-row toggle-row">
      <span>
        {label}
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
function CompanionPage({
  companion,
  connected,
  sessions,
  activeSession,
  onSelectSession,
  onConnect,
  onPlay,
  onNotice,
}: {
  companion?: Companion;
  connected: boolean;
  sessions: Session[];
  activeSession: string;
  onSelectSession: (id: string) => void;
  onConnect: (client: Companion | undefined) => void;
  onPlay: (level: LevelSpec) => void;
  onNotice: (text: string) => void;
}) {
  const [address, setAddress] = useState(
    location.hostname === '127.0.0.1' ? location.origin : 'http://127.0.0.1:',
  );
  const [token, setToken] = useState('');
  const [grant, setGrant] = useState('');
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<LevelSpec>();
  const [summary, setSummary] = useState('');
  const [difficulty, setDifficulty] = useState('2');
  return (
    <section className="page companion-page">
      <div className="eyebrow">THE LOCAL CONNECTION</div>
      <h2>A new way to wait.</h2>
      <p className="intro">
        Turn your last commit into a track. Keep an eye on your agent.
        <br />
        Everything stays on your machine. Arcade needs none of this.
      </p>
      <div className="settings-grid">
        <div>
          <h3>
            <span className="step">01</span> Pair your companion
          </h3>
          <p className="muted">
            Launch the local companion and open its game address. Run <code>clawdash pair</code> for a limited
            pairing token. Tokens are held only for this visit.
          </p>
          {!companion ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const c = new Companion(address, token);
                  await c.rpc('health');
                  onConnect(c);
                  setToken('');
                  onNotice('Companion paired. Your game remains independent.');
                } catch (e) {
                  onNotice(e instanceof Error ? e.message : 'Pairing failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Local companion address
                <input
                  type="url"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  required
                  placeholder="http://127.0.0.1:PORT"
                />
              </label>
              <label className="field">
                Pairing token
                <input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                />
              </label>
              <button className="secondary" disabled={busy}>
                {busy ? 'Connecting…' : 'Pair companion →'}
              </button>
            </form>
          ) : (
            <div className="paired">
              <p>
                <i />
                {connected ? 'Connected locally' : 'Connection lost / unknown'}
              </p>
              <button className="text-button" onClick={() => onConnect(undefined)}>
                Disconnect
              </button>
            </div>
          )}
          <h3>
            <span className="step">02</span> Make a repo run
          </h3>
          <p className="muted">
            Grant a folder explicitly with <code>clawdash grant PATH</code>, then paste its grant ID. Only
            bounded metadata from committed HEAD is used; source files and uncommitted edits are excluded.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!companion) return;
              setBusy(true);
              setGenerated(undefined);
              try {
                const data = await companion.rpc<{
                  fileCount: number;
                  commitCount: number;
                  snapshot: string;
                }>('inspectRepo', { folderGrantId: grant });
                setSummary(
                  `${data.fileCount} tracked files · ${data.commitCount} commits · Based on last commit`,
                );
                const l = await companion.rpc<unknown>('generateRepoLevel', {
                  folderGrantId: grant,
                  difficulty: Number(difficulty),
                });
                setGenerated(parseLevel(l));
              } catch (e) {
                onNotice(e instanceof Error ? e.message : 'Generation failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            <>
              {isDesktop() && (
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    try {
                      const id = await native<string | null>('choose_repository');
                      if (id) setGrant(id);
                    } catch {
                      onNotice('Folder selection failed. Try a companion grant ID.');
                    }
                  }}
                >
                  Choose repository folder…
                </button>
              )}
            </>
            <label className="field">
              Folder grant ID
              <input
                value={grant}
                onChange={(e) => setGrant(e.target.value)}
                required
                disabled={!companion}
              />
            </label>
            <label className="field">
              Difficulty
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} / 5
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" disabled={!companion || busy}>
              {busy ? 'Building & verifying…' : 'Generate track →'}
            </button>
          </form>
          {generated && (
            <div className="generated">
              <p className="eyebrow">TRACK READY</p>
              <h3>{generated.displayName}</h3>
              <p className="muted">{summary}</p>
              <button className="primary" onClick={() => onPlay(generated)}>
                Play repo run ↗
              </button>
            </div>
          )}
        </div>
        <div>
          <h3>Agent signal</h3>
          <p className="muted">
            Opt in from your companion with <code>clawdash integrations install claude</code>. It previews the
            local settings change and asks for consent. Remove it with{' '}
            <code>clawdash integrations uninstall claude</code>.
          </p>
          <p className="muted">
            A turn ending means the agent finished responding. It does not verify the work.
          </p>
          <div className="sessions">
            {sessions.length ? (
              sessions.map((s, i) => (
                <button
                  key={s.sessionId}
                  className={`session ${activeSession === s.sessionId ? 'selected' : ''}`}
                  onClick={() => onSelectSession(s.sessionId)}
                >
                  <span>
                    <b>
                      {s.provider} / {String(i + 1).padStart(2, '0')}
                    </b>
                    <small>
                      {!connected ? 'Connection lost / unknown' : (stateLabel[s.state] ?? 'Agent ready')}
                    </small>
                  </span>
                  <span>{s.toolActivityCount} activities</span>
                </button>
              ))
            ) : (
              <div className="empty-signal">
                <div>⌁</div>
                <p>No signal yet.</p>
                <span>
                  {companion
                    ? 'Your sessions will appear here.'
                    : 'Pair a companion to see local agent activity.'}
                </span>
              </div>
            )}
          </div>
          <p className="muted small">
            Agent events never change the speed, timing, or state of your run. Auto-open and focus are
            separate, opt-in companion preferences.
          </p>
        </div>
      </div>
    </section>
  );
}
