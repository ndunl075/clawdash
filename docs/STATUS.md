# Architecture delivery and evidence

Reviewed 2026-10-12. The implementation is a Windows release candidate; the clean-VM and human game-feel gates below are not yet certified.

| Architecture area                | Implemented evidence                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace / browser independence | Pinned pnpm workspace, strict TypeScript, React/Vite production bundle; Arcade needs no bridge, repo or agent.                                                                                                                     |
| Deterministic gameplay           | Fixed-point 60-tick simulation, swept triangle/solid collisions, input buffer/coyote behavior, replay validation and safe practice checkpoints.                                                                                    |
| Original Arcade content          | First Light (36s), Overclock (44s), Night Shift (52s); nine certified patterns, 81 boundary combinations, 120 composition fixtures and continuous witnesses.                                                                       |
| Astra interface                  | Real React/Phaser menus, selection, HUD, pause/results, three themes, reduced motion, keyboard controls, compact layouts, original locally synthesized track patches and SFX.                                                      |
| Progress / offline               | Physics-version/mode score keys, accurate attempts, partial best snapshots, separate practice records, validated five-track repo cache, explicit PWA caching; native atomic JSON/checksum/backups and serialized writer.           |
| Repo Run                         | HEAD-only metadata/allowlisted bounded manifests, canonical SHA-256/xoshiro vectors, 15-second collection budget, fsmonitor disabled, shallow history rejected, certified finite generation/fallback, privacy-scrubbed challenges. |
| Claude lifecycle                 | Documented command/args hooks, coarsened provider-neutral signals, dedup/order/concurrent sessions, resumed-activity attention clearing, honest turn-ended semantics.                                                              |
| Companion boundary               | Loopback-only random port, strict Host/Origin/bearer checks, revocable pairing, explicit folder grant IDs, schema/size/age/rate/session limits, owner-only Windows ACLs and exclusive secret creation.                             |
| Hook lifecycle                   | Explicit installation, exact owned entries, idempotent removal, atomic backup/recovery, silent bounded emitter, opt-in auto-open with separate focus policy. Tests use temporary Claude settings only.                             |
| Native Windows                   | Tauri 2, standalone Node SEA companion, single instance, tray opt-in, saved bounds, compact/normal/fullscreen, hook consent/settings, owned-companion supervision, per-user NSIS candidate and checksums.                          |
| Open source / release            | MIT project license, original asset manifest, collected upstream notices and MPL sources, contributor/security/install/rollback docs, Linux/Windows checks and Windows candidate build workflow.                                   |

## Automated verification

- Strict TypeScript, production web build, formatting and JavaScript license audit pass.
- 66 unit/integration tests pass, including real HTTP → Git metadata → certified level → lifecycle events, temporary installer configuration, native storage queue/recovery, secret concurrency and ACL replacement.
- Nine Chromium scenarios pass, including offline reload/play, compact checkpoints, partial progress, cached repo replay, unavailable companion, delayed desktop pairing, unknown-save preservation and complete Node/browser simulation hash parity for all three curated tracks.
- `pnpm audit` reports no known vulnerabilities after updating Vite/Vitest and aligning Tauri CLI/runtime.
- `scripts/smoke-sidecar.mjs`: real standalone bridge/emitter/storage/owned-hook install and uninstall pass with Node excluded from PATH. Measured emitter p95: **73.4 ms** (20-process local Windows sample).
- `scripts/smoke-desktop.mjs`: real Tauri WebView Arcade, atomic save/reload, compact/normal/fullscreen, automatic pairing, owned-companion crash recovery, temporary hook consent/removal and cold auto-open/turn-ended handoff pass with Node excluded from PATH. Cold emitter returned in **113.4 ms**, independently of window boot. Screenshots live in ignored `test-results/`.
- Native compiler and NSIS installer build pass locally. Installer output: `apps/desktop/src-tauri/target/release/bundle/nsis/Clawdash_0.1.0_x64-setup.exe`; matching manifest: `dist/SHA256SUMS.txt`.

## Release gates still requiring external evidence

1. **Fresh Windows VM:** execute the actual installer, optional Claude auto-open/attention/turn-ended flow, rollback and uninstaller without Node/development checkout. The automated temporary-profile/no-Node-PATH checks are substantial evidence but are not a fresh VM.
2. **Human game-feel and accessibility review:** play all three tracks and review timing/readability/audio/keyboard/focus/reduced-motion on ordinary hardware. Certified witnesses prove beatability, not enjoyment.
3. **Installed Claude compatibility:** current local CLI version observed as 2.1.287; official hook docs were consulted. No real provider task was launched and no hooks were installed into the developer's actual settings. Validate this exact provider version during the clean-VM scenario.
4. **Performance release record:** capture integrated-graphics FPS, full process-tree memory and cold startup on the documented 16 GB Windows target.

The Windows Computer Use helper could not initialize in this session. Native verification instead used the owned WebView automation surface with isolated fixture profiles. No manual desktop review is claimed. No public release tag is created until the external gates are recorded.

## Feature PRs

Workspace #1; simulation/content #2; repository generation #3; companion/hooks #4; offline Arcade product #5; runtime hardening #6; Windows release configuration #7. Each accepted feature is merged independently.

The final generator is `repo-v2`: derived level IDs bind generator, segment catalog, physics and difficulty versions. Previously baked `repo-v1` snapshots remain unchanged/playable under compatible physics; their progress is not reassigned to newly generated content. Partial clones and missing required manifests are rejected rather than allowing locally available objects to alter the seed.
