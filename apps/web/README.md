# Browser game

React owns navigation, settings and throttled run snapshots. Phaser draws original geometric artwork at a 960 × 540 logical resolution. The renderer steps the shared authoritative simulation at 60 ticks per second, with bounded catch-up; Phaser physics is disabled. Menus and overlays keep keyboard input out of the simulation. The playfield accepts Space, Up and primary pointer input; Escape pauses, R retries, and C requests a safe practice checkpoint.

All visuals, music and effects are generated locally. The Web Audio score is an original short arpeggiated progression defined in `packages/game/src/audio/index.ts`. No remote fonts, audio, analytics or AI are fetched. Music follows simulation ticks and never drives physics.

Browser saves use versioned IndexedDB. Desktop saves use native `load_save` / `persist_save` commands backed by the companion's atomic JSON storage. An unreadable or unknown save stays untouched; Arcade remains available for the current visit. Normal and practice records have separate keys.

Offline caching is explicit under Settings → Install for offline play. The service worker stores the local app shell and loaded production assets, excludes authenticated companion endpoints, and falls back to those files when network access fails. Use the production build to test offline installation.

Run `pnpm build` and `pnpm exec playwright test --config tests/e2e/playwright.config.ts` from the repository root. The standalone test configuration resolves Vite from the installed dependency tree. Browser tests cover play/death/retry, pause input isolation, persisted bests, practice checkpoints, 480 × 270 layout, theme/reduced-motion persistence, offline reload and gameplay, unavailable companion, paired grant-based repo generation, accurate agent turn-ended labels, and preservation of unknown save schemas. Companion responses are mocked in the UI boundary test; bridge integration tests cover the real transport separately.

Visual review evidence: generated Chromium screenshots in `test-results/clawdash-home.png`, `clawdash-tracks.png`, and `clawdash-compact.png`. These were inspected during implementation. Automated simulation and browser tests are not a human playtest. Native window controls, hook installation and actual Windows installer behavior require desktop testing. Vite reports the expected large Phaser bundle (~429 KB gzip for the main JS).
