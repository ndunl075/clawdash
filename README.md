# Clawdash

An offline rhythm platformer for coding downtime. Play three original Arcade tracks, turn a committed Git snapshot into a reproducible circuit, or keep a small Claude lifecycle indicator beside your run. Gameplay never depends on an agent, account, server or AI call.

## Play from source

Install Node 22 and pnpm 10, then:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. Space, Up or touch jumps. Escape pauses. Practice checkpoints and normal bests are independent. Audio begins after a user gesture. Browser offline caching is opt-in in Settings; first load must occur online or from a local server.

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

The canonical implementation blueprint is [ARCHITECTURE.md](ARCHITECTURE.md). See [delivery evidence](docs/STATUS.md) for completed checks and remaining release gates.

## Repository and agent modes

The browser cannot inspect your filesystem. Launch the local companion explicitly, grant a repository using its CLI, then pair the locally served game:

```sh
pnpm build
pnpm cli bridge --static apps/web/dist
pnpm cli grant /absolute/path/to/repository
pnpm cli pair
```

Use the companion URL and enter the pairing token and folder grant ID in the game. Tokens stay on your machine. Repo Run uses committed HEAD metadata and bounded dependency manifests, never source contents or dirty edits. Use a complete local clone with full history; shallow/partial clones and missing required objects are rejected, and Git network fetches are disabled. Large repositories are bounded and may show an actionable limit error. Git must be installed for Repo Run; Arcade remains available without Git.

Claude hooks require explicit installation. Review the path displayed by the CLI first:

```sh
pnpm cli integrations install claude
pnpm cli integrations uninstall claude
```

For source use, consult the CLI help/diagnostics for emitter executable configuration. Packaged installs use the standalone CLI executable. Hooks preserve unrelated configuration, emit only coarsened lifecycle information and fail open when the companion is absent. “Turn ended” does not mean a coding task passed its tests.

## Desktop and release

Windows build prerequisites: Rust/MSVC, Node 22, pnpm 10, WebView2. End users of the packaged build do not need Node. See [Windows instructions](docs/windows.md), [privacy](SECURITY.md), [contributing](CONTRIBUTING.md), and [asset licenses](assets/licenses/README.md).

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/build-sidecar.mjs
node scripts/smoke-sidecar.mjs
pnpm --dir apps/desktop build
```

MIT licensed. Release candidates remain unsigned unless explicitly stated; Windows may display SmartScreen warnings. Automated proof of level beatability is separate from human game-feel review and clean-VM installer acceptance.
