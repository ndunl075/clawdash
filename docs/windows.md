# Windows build, install and rollback

Developers need Node 22.12+ (candidate build uses 22.23.2), pnpm 10.18.3, the pinned Rust 1.99.0 with the MSVC target and Visual Studio C++ Build Tools. WebView2 is required by Tauri. `pnpm --dir apps/desktop build` creates a per-user NSIS installer after `pnpm build` and `node scripts/build-sidecar.mjs`.

The sidecar bundles the TypeScript CLI into Node's single-executable application format. `node scripts/smoke-sidecar.mjs` executes it with Node absent from PATH. `node scripts/smoke-desktop.mjs` exercises the real owned Tauri WebView with temporary runtime/Claude settings, window modes, saves, companion crash recovery and cold auto-open. These are prerequisite checks, not substitutes for clean-VM testing. Build the binary on its target OS/architecture. The release workflow produces installer candidates and SHA256SUMS; it does not automatically publish unreviewed binaries.

Install only a candidate whose checksum matches the supplied manifest. Unsigned builds may prompt SmartScreen. The game starts without hooks, Git or Node; Repo Run additionally needs Git. Hook installation and auto-open are independent explicit opt-ins. Focus stealing and always-on-top default off.

To remove integration, use the game's hook uninstall action or the installed `clawdash-cli.exe integrations uninstall claude` before uninstalling the app. This preserves all unrelated Claude settings and hooks. If settings JSON is malformed, repair it using the adjacent backup before retrying; never replace a user's whole configuration. Disable auto-open before removal. Uninstall the application through Windows Settings. Local progress and backups remain under `%LOCALAPPDATA%/Clawdash`; delete that exact directory only when you explicitly want to wipe your progress. Claude settings live separately under the user's `.claude` directory.

Rollback: uninstall the newer application after removing its owned hooks, install the previous verified candidate, then explicitly reinstall its hooks. Keep the saved progress backup. Do not downgrade incompatible saves without migration support.

## Required clean-VM release record

- Fresh Windows VM, Node/pnpm/development checkout absent; Git optional for Arcade.
- Install candidate; launch three Arcade levels, audio, practice, retry, pause, compact/fullscreen and persistent scores.
- Select Git folder and verify generated witness/cached level.
- With Claude installed, preserve an unrelated hook, install Clawdash hooks, enable auto-open without focus, submit prompt, observe attention and turn-ended semantics; overlapping sessions do not open duplicate windows.
- Close/reopen and crash/restart companion; gameplay and saves survive.
- Remove hooks and uninstall application; unrelated settings remain intact.
- Record OS/build, installer checksum, reviewer and outcome. Never mark this gate passed from a developer build alone.
