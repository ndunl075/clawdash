# Local companion protocol

The CLI explicitly starts a loopback-only companion. The standalone browser game does not require it. Windows stores discovery in `%LOCALAPPDATA%/Clawdash/runtime.json`; other systems use `~/.local/share/clawdash`. `CLAWDASH_HOME` can isolate a test or development instance. Discovery contains only `{protocol:1,port,pid,instanceId}`. Separate random emitter and pairing secrets remain in user-only files; Windows applies an ACL and Unix uses mode 0700/0600.

Run `pnpm cli bridge --static dist`, then visit the printed local URL. `pnpm cli pair` explicitly reveals the browser pairing token. Enter it in the local game. `pnpm cli pair --revoke` revokes existing browser tokens immediately. Hosted web origins are rejected. Tauri's two fixed embedded origins are allowed with token authentication. An OPTIONS preflight carries no protected data.

`pnpm cli grant PATH` explicitly authorizes a canonical local directory and prints its opaque UUID. RPCs accept that UUID only; no browser request may supply a filesystem path. Generator responses expose public aggregate counts or baked levels, never descriptors, paths, raw session identifiers or hook payloads.

Send `POST /rpc` with `Authorization: Bearer TOKEN` and `{v:1,id,method,folderGrantId?,difficulty?}`. Methods are `health`, `listSessions`, `inspectRepo`, `generateRepoLevel`. Valid RPCs return `{v:1,id,ok:true,data}` or `{v:1,id,ok:false,error}`. Transport validation/auth failures use HTTP 400/401/403. `GET /events?after=CURSOR` returns `{v:1,sessions,events,cursor}`. Tokens never go in URLs. Events are held in memory (256 maximum), sessions are capped at 64, and stale sessions show an unknown connection instead of inferred success.

`POST /hook` accepts only the emitter secret, rejects browser Origin headers and validates a strict normalized event schema. All requests enforce Host, permitted Origin, size, age, rate and connection limits. Git/generation requests are serialized. UI loss never stops gameplay.

## Claude integration

`pnpm cli integrations install claude` is explicit opt-in. It prints the user settings path, backs up the original, and merges owned hooks. `integrations uninstall claude` removes only byte-equivalent recorded owned entries and disables auto-open. A changed user hook is preserved. Malformed settings and unsupported policies fail without rewriting originals. The managed ownership sidecar and one bounded backup are beside the Claude settings file.

Hooks follow the [official Claude command-hook reference](https://code.claude.com/docs/en/hooks), reviewed 2026-10-12: exec-form absolute `command` plus `args` avoids shell quoting, `async:true` keeps tasks moving, and the emitter produces no stdout or decisions. Use a current Claude Code version with exec-form support. Developer hooks invoke Node/tsx by absolute paths. Release installs invoke the bundled standalone executable with `--executable EXE` or automatically when running as Node SEA. No integration is installed by tests or normal game startup.

`configure-launcher EXE --auto-open` opts in to detached desktop launch on `UserPromptSubmit`. Focus remains off unless `--focus` is included. SessionStart never auto-opens. A five-second local launch gate avoids duplicate windows, and one normalized pending event hands off a cold start. The native desktop must enforce single-instance and no-focus behavior; its launcher flags are `--agent-start` and optional `--focus-game`.

Remaining release validation: verify current Claude exec-form behavior on the supported pinned version, benchmark emitter p95 latency, and prove the installer/hook/auto-open/uninstall lifecycle on a clean Windows VM without Node. These are release gates, not claims established by fixture tests. Fullscreen-app suppression is not implemented. Same-user processes are within the local trust boundary.
