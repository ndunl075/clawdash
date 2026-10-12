# Clawdash — Technical Architecture

**Status:** Implementation blueprint (MVP first)  
**Target:** Windows-first, cross-platform-ready, offline, free, open source  
**Canonical document:** `ARCHITECTURE.md`  
**License target:** MIT for Clawdash code; separately verify all asset and dependency licenses  
**Last reviewed:** 2026-10-12

> **MANDATORY UI DIRECTIVE — USE ASTRA:** Use **Astra** for Clawdash UI design, implementation, and visual polish: menus, level selection, HUD, settings, pause/results screens, repo summary, compact window, and onboarding. Build a distinct game-first interface, not a dashboard or generic AI-generated template. Astra is a **development-time tool only**: **no Astra, AI model, paid API, account, or cloud service may be required at runtime**. The actual game must ship as bundled, entirely offline-capable code and assets.

## 1. Vision, constraints, and boundaries

Clawdash is a genuinely enjoyable Geometry Dash-inspired rhythm platformer that developers can play during coding-agent downtime. It has three modes:

- **Arcade:** Curated, handcrafted levels; no Git repository or agent required.
- **Repo Run:** Generate a reproducible, playable level from local Git metadata.
- **Agent Run:** Play an Arcade or Repo Run level while independently displaying coding-agent lifecycle signals.

The game must work without any coding agent, repository, network, or desktop wrapper. Agent hooks never gate gameplay or change the coding task. No raw source code, prompts, tool input/output, transcript, secrets, telemetry, or private repo metadata leave the device.

### Non-negotiable requirements

1. Full arcade gameplay with reliable jump and collision behavior, instant retries, percentage progress, attempts, practice checkpoints, sound/music, multiple themes, and personal bests.
2. At least **three high-quality curated levels** before advanced agent features.
3. Deterministic repository generation from bounded, allowlisted Git and dependency metadata only.
4. Every generated level must be beatable under the shipping game physics, using certified patterns and a full-level verification path.
5. Claude Code integration based on **documented hooks**, installed only with explicit user consent.
6. Nonblocking auto-open/activate on agent work start when the user enables it; accurate, unobtrusive finish/attention signals.
7. Windows-compatible desktop packaging, with a standalone browser game available independently.
8. Offline functionality, no paid APIs, no account, no hosted backend, no telemetry, no ads.
9. A documented installer, rollback/uninstall path, reproducible builds, and automated tests.
10. Original designs, sounds, geometry, and licensed assets; no Geometry Dash asset or music redistribution.

### Out of scope for MVP

Online leaderboards, multiplayer, user accounts, hosted sharing, matchmaking, remote agent control, arbitrary execution from a browser, a level editor, more than one fully supported coding-agent provider, and monetization.

## 2. Architecture at a glance

**Architecture choice:** A small TypeScript monorepo separates **simulation**, **rendering**, **level generation**, **agent events**, **local system integration**, and **persistence**. React renders the application shell. Phaser 3 renders gameplay and handles audio/particles/scenes. An authoritative, headless TypeScript simulation handles player movement and collision so the exact same rules can be used in playback, level validation, replay, and tests. Do **not** also apply competing Phaser Arcade physics forces to the player.

~~~mermaid
flowchart TB
  subgraph Client["Shared client"]
    UI["React + Vite UI (Astra-designed)"]
    View["Phaser 3 rendering, scenes and audio"]
    Sim["Deterministic fixed-tick simulation"]
    UI --> View
    View <--> Sim
  end

  Levels["Versioned curated segments and level compiler"]
  Repo["Local Git metadata reader + canonical fingerprint"]
  Gen["Seeded level generator + validator"]
  Levels --> Gen
  Repo --> Gen
  Gen --> Sim
  Levels --> Sim

  Hooks["Claude Code lifecycle hooks"]
  CLI["Short-lived hook emitter CLI"]
  Bridge["Authenticated loopback bridge"]
  Adapter["Versioned event normalizer + session reducer"]
  Hooks --> CLI
  CLI --> Bridge
  Bridge --> Adapter
  Adapter --> UI

  Browser["Browser / offline PWA"]
  Desktop["Tauri 2 desktop host + bridge sidecar"]
  Browser --> UI
  Desktop --> UI
  Desktop --> Bridge

  Store["Local progress / settings storage"]
  UI <--> Store
~~~

### Runtime configurations

| Configuration | Gameplay | Repo Run | Agent Run | What runs |
| --- | --- | --- | --- | --- |
| Browser, standalone | Yes | No local Git access by default | No live agent stream by default | Static Vite bundle + IndexedDB |
| Browser with local companion | Yes | Yes, after local authorization | Yes, after local pairing | Browser + explicitly launched local bridge |
| Desktop | Yes | Yes | Yes, with opt-in Claude hook installation | Tauri host + bundled bridge and hook CLI |

**Important:** Browsers cannot silently inspect arbitrary local Git repositories. Repo Run in the browser requires the local companion/pairing flow; hosting a static site must never claim local Git access. The standalone web game remains fully playable without it. Static distribution or PWA caching can enable browser offline usage once its assets have been installed/cached.

## 3. Technology and package decisions

| Layer | Choice | Reason |
| --- | --- | --- |
| Primary language | TypeScript, strict mode | Shared models, tools, UI, core and tests |
| App shell | React + Vite | Small SPA with efficient build and lightweight UI |
| Game renderer | Phaser **3**, Canvas/WebGL | Scenes, sprite effects, transitions, input adapter, audio |
| Authoritative game rules | Headless TypeScript simulation | Precise deterministic tests and generated-level validation |
| Desktop host | Tauri **2** | Small native Windows application, window management, OS integration |
| Desktop native glue | Minimal Rust required by Tauri | Platform APIs only; **game and product logic remain TypeScript** |
| System service | TypeScript Node bridge, bundled as a stand-alone executable for release | Git inspection, hook reception, session normalization, settings |
| Developer package manager | pnpm workspaces | Reproducible monorepo and shared dependencies |
| Validation | Zod (or comparably strict schemas) | Parse and bound every IPC/event/save boundary |
| Randomness | Versioned 32-bit PRNG seeded from SHA-256 | Same version + same fingerprint = same generated content |
| Web persistence | IndexedDB (with narrowly scoped fallback where necessary) | Offline storage without a backend |
| Desktop persistence | Atomic JSON files, one writer | No native database dependency in MVP |
| Test stack | Vitest, Playwright, headless simulation, Windows CI | Functional, physics, security, end-to-end tests |
| Music and FX | Bundled properly licensed tracks + Web Audio | No streaming, subscriptions, or online audio generation |

**Dependency rule:** Pin direct dependency major versions and the lockfile. Test upgrades against simulation golden fixtures and regenerate level artifacts only when a versioned migration is deliberate. Check Tauri sidecar packaging and Node executable bundling on each target OS; these are build requirements, not presumed to work without verification.

## 4. Repository structure

~~~text
clawdash/
├─ apps/
│  ├─ web/
│  │  ├─ public/                    # PWA assets, icons
│  │  ├─ src/
│  │  │  ├─ app/                     # routing, state orchestration, providers
│  │  │  ├─ components/              # Astra-designed React UI
│  │  │  ├─ features/                # arcade, repo-run, agent-run, settings
│  │  │  ├─ game-host/               # Phaser mounting + input coordination
│  │  │  ├─ storage/                 # IndexedDB implementation
│  │  │  └─ styles/                  # design tokens and accessible states
│  │  ├─ index.html
│  │  └─ vite.config.ts
│  └─ desktop/
│     ├─ src/                        # desktop-only React features
│     ├─ src-tauri/
│     │  ├─ src/                      # minimal native app bootstrap and commands
│     │  ├─ capabilities/             # least-privilege Tauri permissions
│     │  ├─ binaries/                 # OS/arch sidecar builds (generated)
│     │  └─ tauri.conf.json
│     └─ package.json
├─ packages/
│  ├─ game/
│  │  ├─ src/simulation/              # physics, collisions, input, tick state
│  │  ├─ src/renderer/                # Phaser scenes, render adapters, camera
│  │  ├─ src/audio/                   # musical timeline, effects, mute settings
│  │  ├─ src/entities/                # sprites, obstacles, particles
│  │  └─ src/replay/                  # tick-based input replays
│  ├─ level-schema/                   # serializable LevelSpec and migrations
│  ├─ level-content/                  # three curated levels + certified segments
│  ├─ level-generator/
│  │  ├─ src/git/                     # allowlisted metadata collection
│  │  ├─ src/fingerprint/             # canonicalization + SHA-256 hashing
│  │  ├─ src/compiler/                # seeded pattern selection/stitching
│  │  └─ src/validator/               # deterministic run verification
│  ├─ agent-core/                     # event contracts and lifecycle reducer
│  ├─ agent-adapters/
│  │  ├─ claude/                      # documented Claude Code hook translator
│  │  └─ codex/                       # reserved for later, not MVP
│  ├─ local-bridge/                   # authorized loopback service + Git IPC
│  ├─ cli/                            # install/uninstall, hook emitter, diagnostics
│  ├─ storage/                        # schema and common repository interfaces
│  ├─ shared/                         # common configuration/errors/utilities
│  └─ ui/                             # shared Astra-designed React UI
├─ assets/
│  ├─ music/                          # credited/distributable bundled audio
│  ├─ sprites/                        # original art assets
│  └─ licenses/                       # attribution and license manifest
├─ tests/
│  ├─ fixtures/                       # Git repo snapshots and input golden runs
│  ├─ integration/                    # bridge, adapters, storage, installer
│  └─ e2e/                            # manual play, desktop flow, browser PWA
├─ scripts/                            # release and platform build scripts
├─ docs/                               # gameplay tuning, security, contributors
├─ .github/workflows/                  # checks and release builds
├─ ARCHITECTURE.md
├─ README.md
├─ LICENSE
├─ CONTRIBUTING.md
├─ pnpm-workspace.yaml
├─ package.json
└─ pnpm-lock.yaml
~~~

**Naming note:** The /packages/ui comment refers to **Astra-designed React components**. Do not replace the UI architecture with another framework as a side effect of Astra use.

### Dependency direction

- `shared` and `level-schema` have no runtime dependency on React, Phaser, Git, Node, Tauri, or adapters.
- `game/simulation` can import `level-schema` and `shared`; it must run in Node tests without a DOM.
- `game/renderer` imports simulation APIs, not the other way around.
- `level-generator` imports level schema, certified content, and simulation validator; Git inspection is behind an injected repository adapter.
- `agent-adapters` map provider-specific local signals into `agent-core` without importing UI code.
- `local-bridge` owns desktop-side privileged functionality and exposes narrowly defined operations.
- Apps compose the packages; no package imports from an app. No circular dependencies.

## 5. Game subsystem

### 5.1 Simulation ownership and state machine

Use one authoritative simulation with discrete ticks. It owns player position, velocity, grounded state, hazard/solid contact, progress, attempt number, timers, checkpoint state, and completion. Phaser displays snapshots and interpolates **visuals only**.

Game flow:

~~~text
BOOT -> MENU -> LEVEL_READY -> PLAYING
                       |          |
                       |          +-> PAUSED -> PLAYING
                       |          +-> DEAD -> RESPAWNING -> PLAYING
                       |          +-> COMPLETED -> RESULTS -> MENU / REPLAY
                       +-> MENU
~~~

Practice mode is a flag on a run, **not** a different collision engine. A practice checkpoint stores an explicit safe, validated simulation snapshot. Practice completion and PBs must not overwrite normal-mode completions.

### 5.2 Deterministic physics contract

Initial engineering parameters (subject to playtesting; lock per physics version):

| Property | Starting target |
| --- | --- |
| Simulation clock | Fixed **60 ticks/second** |
| Simulation timing | Integer tick index and fixed-point coordinates; no wall-clock physics |
| Horizontal motion | Constant world-space velocity for each speed tier |
| Vertical motion | Constant gravity and a fixed jump impulse |
| Input | Space, Up, pointer/touch; unified `jumpPressed` and `jumpHeld` |
| Rotation | Renderer-only unless an explicitly versioned gameplay rule needs it |
| Death | Collision causes immediate death state; rapid reset after brief optional effect |
| Progress | Clamped percentage of player world X / finish X |
| Camera | Follow player smoothly; fixed gameplay geometry independent of viewport |

Prefer integer or fixed-point position/velocity operations for exact replay parity; do not change simulation math based on render FPS or monitor refresh. If interpolation is used, never feed interpolated values back into collision checks.

Input is latched into a per-tick bitmask. Pick and test forgiving but consistent jump semantics (e.g. 2-tick coyote margin, 3-tick input buffer, and configurable hold-to-chain-jump behavior). This is a **playtesting decision**, not permission for unpredictable mechanics.

Collision design:

- Use a broadphase spatial grid and continuous/swept checks for high-speed movement where necessary.
- Solid platforms use precise player-body vs platform contact and deterministic tie-breaking.
- Spike/hazard art and colliders are separate; use conservative triangle/polygon narrow-phase checks (not giant unfair bounding boxes).
- Prefer small forgiving insets for hazards; visual affordances must match what is lethal.
- Collisions are resolved in a fixed, documented order, using the same logic in the client and verifier.
- No randomized obstacle movement unless driven by a versioned, deterministic pattern.
- World and obstacle coordinates are independent of display pixel scaling.

The **player's collision body is not a visual rotation bounding box**. A rotating cosmetic cube must not accidentally increase the lethal hitbox.

### 5.3 Rendering and input architecture

Render order: parallax background -> safe terrain -> hazards -> player -> trails/particles -> progress and foreground overlays. Distinguish safe surfaces clearly from lethal obstacles with **shape and contrast**, not color alone.

Phaser responsibilities: scene lifecycle, sprites/shapes, camera, particles, visual tweening, and local audio playback. React responsibilities: menus, overlays, settings, navigation, accessibility, persistent UI state, window mode selection, agent HUD. Avoid keeping a giant React component in sync with each frame; publish only throttled UI snapshots (e.g. progress, attempts, run state) via an adapter.

Required gameplay features:

- Short startup path: Play -> select -> immediate movement.
- Space/Up/click/touch mapped to a single input dispatcher with debouncing.
- Instant restart / retry flow; optional death effects must never hold the simulation hostage.
- Clear progress %, attempts, best %, completion time, mute status and pause.
- Normal and practice mode with independent progress records.
- Menu, pause, death, results, and loading transitions.
- Fullscreen, desktop compact window, persistent volume and visual settings.
- 3 original aesthetic themes with coherent sprites and high-contrast hazard language.
- Keyboard focus rules and reduced-motion option.

### 5.4 Audio and rhythm

Level patterns are laid out against a musical beat grid. A `LevelSpec` declares BPM, beat offset and music asset or synthesizer patch. Compile pattern start positions using the fixed speed and tempo. Use the Web Audio clock for playback scheduling, but use **simulation ticks for obstacle timing**. Music must not mutate physics.

Curated tracks must be original, CC0, or compatible with distribution; store attribution/license details with each asset. Repo-generated mode can use a bounded selection of licensed loops or deterministic local synthesis. Provide a mute toggle and separate music/SFX volume. Handle browser autoplay restrictions by unlocking audio after a user gesture. Account for latency calibration as a settings feature if playtesting shows it is needed.

## 6. Level model, curated content, and validation

### 6.1 Versioned serialized format

A published level is a **content artifact**, not a procedure that has to rerun on every play.

~~~ts
type LevelSpec = {
  schemaVersion: number;
  physicsVersion: string;
  generatorVersion?: string;
  segmentCatalogVersion?: string;
  levelId: string;                 // derived ID, no private repo data
  mode: "arcade" | "repo";
  displayName: string;
  seed?: string;                   // never expose repo fingerprint in exports
  themeId: string;
  bpm: number;
  audioId: string;
  totalTicksEstimate: number;
  finishX: number;
  difficultyTier: 1 | 2 | 3 | 4 | 5;
  chunks: LevelChunk[];            // positions + certified pattern references
};

type LevelChunk = {
  patternId: string;
  startX: number;
  obstacleInstances: Array<{
    kind: "spike" | "platform" | "gap" | "block" | "decoration";
    x: number;
    y: number;
    width: number;
    height: number;
    variant?: string;
  }>;
};
~~~

Use unique versioned IDs. Reject unknown schema versions and oversized/untrusted imported levels. Treat local saves and challenge imports as untrusted data; validate before rendering. Do not serialize runtime objects, functions, file paths, branch names, or Git file lists.

### 6.2 Curated level design

Ship at least three carefully crafted tracks:

1. **First Light:** Onboarding, readable single/double spikes, simple gaps.
2. **Overclock:** Faster sections and combinations; teaches timing discipline.
3. **Night Shift:** Harder mixed patterns and rhythmic transitions, still fair.

Names are working titles. Define each level as readable, editable data, with design-review passes and real playtests. Do not claim difficulty based solely on a numeric generator parameter.

### 6.3 Certified segment library

The generator chooses only certified patterns with explicit:

- supported physics version and speed tier;
- start and end player state (grounded, vertical velocity, and relevant input state);
- terrain profile and required entry/exit safe distance;
- BPM/beat-length compatibility;
- difficulty cost and visual spacing constraints;
- a tested **witness input sequence** (per tick, press/release);
- max consecutive precise jumps and cooldown/safe-rest annotations.

Segment certification is an offline development operation run in CI with the same physics package. A full generated level must stitch compatible boundaries and replay a witness input sequence across the **entire level**, not only each segment. Do not simply assume two separately beatable segments are beatable back-to-back.

When full-level verification fails, deterministically choose the next permitted segment combination up to a bounded attempt count, then fall back to a known-safe template. Never publish an unverified generated layout. Always terminate generation; no unbounded solver search.

### 6.4 Solver and validity levels

For MVP, prefer a **constructive proof of playability**: certified segments, neutral transition zones, and a continuous witness replay from level start to finish. Supplement it with search-based reachability (beam search/A* over quantized states) during authoring and CI, particularly for new patterns. This proves that a valid input sequence exists under the shipping simulation; it does not guarantee that human players find a level enjoyable. Human playtesting remains a required release gate.

Tests must assert that procedural levels cannot soft-lock, spawn inside hazards, contain impassable gaps, misalign start/finish locations, or place unfair hazards at segment boundaries.

## 7. Deterministic Git-to-level pipeline

### 7.1 Scope and privacy

Repo Run analyzes **local Git metadata** and narrowly allowed dependency manifests. It must **not** read application source code, environment files, secret files, arbitrary text contents, Git commit messages, or full transcript/tool output.

Allowed metadata (when available):

- HEAD commit object ID, parent/ancestry IDs and aggregate recent commit statistics.
- Tracked file paths **in memory only** to calculate extension counts, directory depth, category counts and language proportions.
- Git tree/index object IDs and tracked-file modes; no blob content reads for ordinary files.
- Directory shape, total tracked files, languages by extension mapping, test-file indicator counts.
- Explicitly allowlisted, bounded dependency manifest fields (e.g. package names/counts and supported version formats) read from the **selected committed snapshot**, not arbitrary paths.
- Optional structured local test-run summary supplied separately **with user consent**; do not execute tests merely to generate a level.

Exclude `node_modules`, build artifacts, vendored and ignored directories from derived summaries by consistent documented rules; if tracked, record high-level counts in a predictable way. Treat submodules and symlinks as metadata entries without traversing into arbitrary external paths. Bound tracked-file count, manifest sizes, history depth, total processing time and Git output bytes.

### 7.2 Reproducibility contract

For v1, **Repo Run means the selected committed HEAD snapshot**. Uncommitted working-tree edits are excluded by design; surface a small "Based on last commit" message when the worktree is dirty. If HEAD is missing (a brand-new Git repo), support a clearly labeled staged-index snapshot or explain how to make an initial commit. Never silently hash live file contents or rely on filesystem mtime.

Compute:

~~~text
repoDescriptorV1 =
  canonical JSON {
    generatorVersion,
    headOrIndexSnapshotId,
    sorted tracked-object metadata,
    normalized extension/language counts,
    normalized directory statistics,
    bounded ancestry/statistics summary,
    allowlisted manifest summary
  }

fingerprint = SHA-256(UTF-8(repoDescriptorV1))
prngState   = first 128 bits of fingerprint, explicit byte order
level       = compile(prngState, generatorVersion, segmentCatalogVersion,
                      physicsVersion, repoDescriptorV1.publicAggregates)
~~~

Canonical JSON must specify key sorting, normalized POSIX paths, Unicode normalization, line endings, numeric representation, lowercase rules, null handling, and stable sort order. Do not use timestamps from the local clock, iteration order from unordered maps, OS-local paths, platform-specific hashes, `Math.random()`, or wall-clock time during level compilation.

Use a documented, test-vector-covered seeded PRNG (such as a 32-bit xoshiro variant) whose implementation behaves the same in Node and browsers. Bind the output to explicit generator, catalog and physics versions. **Identical committed snapshot + identical generator/catalog/physics versions must produce identical serialized level bytes.** A software update can change newer versions, but must not retroactively modify saved snapshots or records.

### 7.3 Repo feature mapping

| Derived input | Game effect |
| --- | --- |
| Language proportions | Palette, parallax motifs, ambient particles |
| File and directory counts (clamped) | Length bracket and sectional variety |
| Directory nesting | Section progression/visual layering |
| Commit count/cadence buckets | Rhythm/texture motifs and compatible pattern families |
| Dependency count/category buckets | Decoration and optional beat variation |
| Optional approved test summary | Cosmetic theme detail only unless verified |

All mappings use **clamped, quantized ranges**. Large repositories must not generate impossible or excessively long levels. Complexity metrics may adjust which **certified** difficulty tier/patterns are chosen; they must never directly position spikes or alter physics.

Provide a minimum and maximum length; target a short, replayable duration, with progressively harder pools and an explicit user-selected difficulty override. A huge monorepo must still yield a practical level.

### 7.4 Pipeline stages

~~~text
User selects local Git folder
  -> validate permission and repository root
  -> collect allowlisted, bounded Git metadata
  -> produce canonical private descriptor
  -> derive fingerprint + stable seeded PRNG state
  -> map public aggregates to theme/length/tier
  -> choose certified segment sequence deterministically
  -> stitch geometry, rhythm and safe boundaries
  -> full physics witness replay / validation
  -> fallback deterministic certified layout if needed
  -> cache a versioned LevelSpec locally
  -> render/play
~~~

Expose diagnostics such as generator version, segment IDs, level checksum, and proof replay status. Keep raw file lists and private fingerprint out of logs, HUD, share artifacts, and crash reports.

### 7.5 Safe challenge exports (post-MVP)

Export **only** the level geometry, timing, selected non-sensitive visual theme/audio identifiers, and format versions after size and privacy checks. Explicitly omit repository path, repo URL, commit SHA, raw seed/fingerprint, filenames, dependency identities, commit author/messages, and any original source metadata. Reimported levels are played as self-contained challenges without resolving the source repo. Test exports against private-repo fixtures.

## 8. Coding-agent lifecycle integration

### 8.1 Provider-independent event contract

~~~ts
type AgentEvent =
  | { type: "agent.started"; eventId: string; sessionId: string;
      occurredAt: string; provider: "claude" | "codex" | "manual" }
  | { type: "agent.activity"; eventId: string; sessionId: string;
      occurredAt: string; provider: string; category: string }
  | { type: "agent.needs_attention"; eventId: string; sessionId: string;
      occurredAt: string; provider: string; attention: "permission" | "input" | "other" }
  | { type: "agent.turn_completed"; eventId: string; sessionId: string;
      occurredAt: string; provider: string }
  | { type: "agent.turn_failed"; eventId: string; sessionId: string;
      occurredAt: string; provider: string; category: string }
  | { type: "agent.session_ended"; eventId: string; sessionId: string;
      occurredAt: string; provider: string };

type AgentSession = {
  sessionId: string;
  provider: string;
  state: "idle" | "working" | "attention" | "turn_ended" | "error" | "ended";
  lastSeenAt: string;
  toolActivityCount: number;
  verification: "unknown" | "verified_pass" | "verified_fail";
};
~~~

`eventId` is unique per delivered event and used for idempotence. ``sessionId`` is a local opaque ID; do not expose raw provider session identifiers publicly. Event timestamps are for UI ordering/diagnostics, never level physics. State updates are reducer-driven so replayed events can be tested headlessly and concurrent Claude sessions are kept separate.

**Critical semantic distinction:** `agent.turn_completed` means the agent finished responding. It **does not** mean the coding task, build, tests, or deployment succeeded. Show "Turn ended" or "Agent ready", **not** "Success" or "Shipped". Only show a verified-pass badge when a trusted, explicit structured test/build result is observed by an approved local verifier. For MVP it is acceptable to never claim verified success.

### 8.2 Claude Code hooks mapping

Use documented Claude Code **command hook** events, not polling internal implementation files or reading private transcripts:

| Claude Code hook | Clawdash behavior |
| --- | --- |
| `SessionStart` | Mark session available / optionally resume bookkeeping; **do not auto-open on session start alone** |
| `UserPromptSubmit` | Map to `agent.started`; optionally reveal the game if enabled |
| `PostToolUse` | Coarsened `agent.activity`; do not send tool payload or output |
| `PostToolUseFailure` | Activity/failure indicator, not automatically full-turn failure |
| `PermissionRequest` and relevant `Notification` | `agent.needs_attention` when appropriate |
| `Stop` | `agent.turn_completed`; leave the game and saved progress intact |
| `StopFailure` | `agent.turn_failed` with bounded error category |
| `SessionEnd` | `agent.session_ended`; clear presence after delivering close signal |

Not every notification means attention is required; use the documented notification type. `TaskCompleted` and `SubagentStop`, if used later, are scoped events and **must not be conflated with parent-turn or overall-task success**. Restrict tool-category telemetry to a small explicit set like "editing", "testing", "searching", "other"; never forward command arguments, prompts, paths, file contents, test output, or raw error messages.

### 8.3 Hook installation and behavior

- Opt-in command such as `clawdash integrations install claude`; first show which local Claude settings file will change.
- Merge **only** Clawdash-owned entries into existing hooks in `~/.claude/settings.json`; preserve unrelated hooks and settings; create an atomic backup before writing.
- Prefer an installed absolute path to the tiny local `clawdash-hook` executable, with correct Windows quoting and no shell expansion of arbitrary project data.
- For every hook: read bounded JSON from stdin; validate/normalize; best-effort deliver; close stdin/stdout without output or decisions; **exit 0 on normal bridge absence/errors**; never block or influence Claude's permission/task execution.
- Favor nonblocking/async hook configuration when compatible with the particular event and current Claude Code behavior, but do not depend on async callbacks to report result data back to Claude.
- Hook process latency budget: target under 100 ms when bridge is present; hard upper bound through short connection timeouts. Never do Git inspection or level generation in the hook handler.
- `clawdash integrations uninstall claude` deletes only Clawdash-managed hook entries, restores prior structure, removes Clawdash runtime registrations, and leaves unrelated configuration intact.
- Detect malformed settings, duplicates, managed-policy restrictions, missing executable and upgrades safely; supply diagnostics and manual recovery instructions.

**Source of truth:** https://code.claude.com/docs/en/hooks . Re-check documented event names, output contracts, Windows command semantics, async support and hook timeouts against the pinned Claude Code version during implementation and CI.

### 8.4 Multiple agents and game HUD

Track sessions by (provider, session ID). An agent can turn idle without closing the game. If multiple sessions run, show a small stack/count and an explicit active selection, not several competing overlays. Never bind level speed, hazards or jump response to agent activity. Activity is cosmetic UI-only. Attention can trigger a silent/toast notification, including when the game is paused, without discarding the run.

### 8.5 Future adapters

`packages/agent-adapters/codex` is only a reserved interface until documented, reliable local events are validated. Never parse unstable private log formats or imply Codex support is shipped before it is implemented and tested. Implement capability negotiation so adapters can omit signals they cannot reliably provide.

## 9. Local bridge, CLI, and IPC

### 9.1 Components

1. **Hook emitter:** tiny executable launched per Claude hook; validates a small event and forwards it.
2. **Bridge service:** loopback-only local process owned by the current OS user; maintains sessions, metadata generation requests, and desktop notification requests.
3. **Client transport:** authorized WebSocket or equivalent request/stream interface for the browser companion and React client.
4. **Desktop host:** Tauri supervises/starts the bundled bridge and manages native windows. The browser-only game never starts the bridge by itself.

The bridge is a trusted boundary: React sends **commands from a predefined allowlist**, never shell strings. Git is invoked through fixed, audited argv arrays in the local service. No user-submitted executable, arbitrary URL callback, or terminal command is accepted over IPC.

### 9.2 Transport and authentication

- Bind to **127.0.0.1 only**, with a random OS-assigned port. Reject non-loopback bind and unexpected Host/Origin values.
- Store runtime discovery (port, protocol, PID/instance ID) in an OS-user-readable local app-data file; store a high-entropy per-install secret separately with OS-user-only filesystem permissions / Windows ACLs.
- Each HTTP emitter request carries a Bearer token in a header. Browser WebSocket clients must complete an authenticated first-message handshake **before** subscriptions or commands become available.
- Reject hostile browser origins, even with a leaked port. Do not expose permissive CORS or unauthenticated HTTP endpoints. No token in URLs, logs, query strings, or Git hooks committed to repositories.
- Local companion pairing requires an explicit user action and a revocable limited token; a hosted static web page is never trusted automatically. Private Network Access/browser restrictions may require the companion to serve a same-origin local UI.
- Validate payload schema, maximum body size, allowed event types, event age, rate limit and session quotas. Close idle connections. Reject oversized inputs before parsing.
- Treat a secret readable by the same OS user as a local-machine boundary, **not** as isolation from processes already compromised under that OS account.

### 9.3 Example bridge protocol

~~~ts
type ClientToBridge =
  | { v: 1; id: string; method: "health" }
  | { v: 1; id: string; method: "listSessions" }
  | { v: 1; id: string; method: "subscribeAgentEvents" }
  | { v: 1; id: string; method: "inspectRepo"; folderGrantId: string }
  | { v: 1; id: string; method: "generateRepoLevel"; folderGrantId: string;
      difficulty?: 1 | 2 | 3 | 4 | 5 };

type BridgeToClient =
  | { v: 1; id: string; ok: true; data: unknown }
  | { v: 1; id: string; ok: false; error: "unauthorized" | "invalid" |
      "not_found" | "unsupported" | "busy" | "internal" }
  | { v: 1; type: "agentEvent"; event: AgentEvent };
~~~

`folderGrantId` refers to a folder the user has already selected through native OS file/folder permission UI. **Never accept arbitrary path traversal or an unapproved absolute path from a browser RPC.** For CLI-only explicit repo selection, validate a user-given directory outside the browser protocol.

The event pipeline should deduplicate on `eventId`, preserve per-session ordering, tolerate out-of-order/retried delivery, and fail closed on invalid input. Hooks should remain best-effort: absence of the bridge must not break Claude Code.

### 9.4 Native auto-launch and focus policy

Default setting: **auto-open OFF** until the user opts in.

With auto-open enabled:

1. `UserPromptSubmit` fires and a hook emitter returns immediately after best-effort delivery.
2. If the desktop app is already running, the bridge asks the single running Tauri instance to show/activate the existing game window; don't spawn one per tool call.
3. If not running, the installed launcher starts Tauri **detached** with a sanitized startup indicator and bounded local pending-event handoff; the hook does not wait for full application boot.
4. The app restores the last selected playable level, or shows a polished quick-start. It never changes Claude's working directory or task.
5. On `Stop` or attention, a compact status toast is displayed without closing/rewinding gameplay.

Do not steal keyboard focus by default, even if the window becomes visible; provide a separate opt-in "focus game when opened" preference. Provide optional always-on-top compact mode (off by default), per-monitor window bounds, and a "never auto-open while in fullscreen app" policy if practical on Windows.

### 9.5 OS integration approach

For release builds, the Node bridge and hook emitter must be packaged as **standalone, locally executable binaries** (for example, a rigorously tested Node single-executable distribution). Users should not need to install Node merely to run a packaged Windows desktop app. The development workflow may use pnpm/Node. Bundle the bridge using Tauri's documented sidecar mechanism and narrow shell permissions. A small native bootstrap may be used if necessary for robust Windows detached launch and single-instance handoff.

**Packaging gate:** Prove on a fresh Windows VM that the signed-or-clearly-unsigned distributed installer can launch, install hooks, auto-open on prompt, process completion, and uninstall cleanly *without Node or a development checkout present*. If standalone Node packaging fails or creates an unstable runtime, use a minimal native bridge instead while preserving the TypeScript contracts; do not ship an untested assumption.

Tauri references: https://v2.tauri.app/develop/sidecar/ and https://v2.tauri.app/plugin/single-instance/ .

## 10. Storage and offline model

The app must retain progress and settings after crashes and app updates.

~~~ts
type SavedProgress = {
  schemaVersion: 1;
  levels: Record<string, {
    attemptsNormal: number;
    attemptsPractice: number;
    bestNormalPercent: number;
    bestPracticePercent: number;
    completedNormal: boolean;
    completedPractice: boolean;
    bestCompletionTicks?: number;
    updatedAt: string;
  }>;
  cachedRepoLevels: Record<string, LevelSpec>;
};

type UserSettings = {
  schemaVersion: 1;
  musicVolume: number;
  effectsVolume: number;
  reducedMotion: boolean;
  themeId: string;
  autoOpenAgentRun: boolean;
  focusOnAutoOpen: boolean;
  alwaysOnTop: boolean;
  lastMode: "arcade" | "repo" | "agent";
};
~~~

In practice use a stable key including **levelId + run mode + physics version**. Practice must never mark normal mode completed. Keep retries and bests distinct. Apply per-field schema defaults and migration functions; never silently discard the whole save on one invalid record.

- **Web:** IndexedDB and a promise-based `StorageRepository` implementation. Support loading without network; PWA asset caching is opt-in and versioned.
- **Desktop:** User-specific app-data JSON with one writer, serialized updates, temp-file + atomic rename, bounded backup copies and checksum/migration checks. Lock or route concurrent writes to the bridge's one-writer queue.
- Separate runtime secret from settings and progress; neither cached repo metadata nor token belongs in share exports.
- Store only minimal session display metadata in memory by default; event retention is bounded and local, off by default for debugging.
- Provide export/import for progress as a future enhancement after strict validation and versioning.
- Never sync or upload progress; no account, cloud backup, or analytics service.

## 11. UI, UX, and accessibility — ASTRA DIRECTIVE

**Use Astra for UI development and polish.** This applies to the entire player-facing visual system, including the shared React UI in web/desktop, boot/menu flows, settings, results, HUD, notifications, and responsive compact/fullscreen layouts. Use Astra to implement and iterate on real working UI components rather than static mockups. Run the actual game while designing; gameplay remains the focus.

### Visual identity

- Near-black/navy canvas background, electric green accent; complementary hot pink/cyan/purple obstacles used meaningfully rather than as random dashboard gradients.
- Crisp original geometric characters, strong silhouette hierarchy and readable hazard edges.
- Sound, subtle screen shake and original particle bursts at intentional moments.
- Compact one-line HUD (progress, attempts, agent indicator); move complex settings entirely off the playfield.
- Maintain readable layouts at 480x270-ish compact view and 16:9 fullscreen; fit high-DPI displays without changing collision coordinates.
- Motion style must be cohesive. Honor reduced-motion preferences and adjustable flashes/screen shake.
- No generic analytics cards, filler content, template dashboards, gratuitous panel borders, or UI gimmicks that compete with the game.

### Screens and interactions

- **Home:** One primary Play action, mode selection, last-run resume, small settings entry.
- **Level select:** Curated levels and bests; Repo Run entry with one clear explanation of local access.
- **Gameplay:** Full canvas, unobtrusive progress/attempts, pause/mute, optional compact agent status.
- **Pause:** Resume, Restart, Practice, Audio, Exit.
- **Results:** Completion, personal best, attempts, retry/next.
- **Repo Run:** Folder selection, deterministic summary ("generated from last commit"), progress/validation, play.
- **Agent Run:** Active session indicator, tool-category activity and attention/turn-ended toast, nothing blocking jump input.
- **Settings:** Audio, controls, effects, theme, fullscreen/compact, installation/uninstallation of hooks, opt-in window preferences.
- **First run:** Immediately playable Arcade mode. No installation of hooks before consent.

Keyboard-only navigation in menus, visible focus, sufficient contrast, configurable reduced effects, and meaningful text for agent notifications are part of acceptance, not post-launch extras. Avoid screen-reader claims for canvas content that have not been tested; offer real text alternatives for menus/statuses.

## 12. Windows and desktop distribution

**Windows is the MVP release gate.** Add macOS/Linux only after path, permission, tray, focus, bundling, hooks and installer flows are actually tested.

Desktop lifecycle:

- Tauri single-instance guard.
- Launch game/window fast, optionally minimize to tray.
- Start the bridge under the current OS user only; handle crashes/restarts without duplicate bridge listeners.
- Installer places stable native launcher and hook emitter in a discoverable app path.
- Opt-in auto-start at login is separate from hook installation; do not install a background service without consent.
- Support compact floating window, normal and fullscreen states, independent settings, and restore position on multiple monitors.
- Close window should follow an explicit setting (quit or tray) so hook behavior is predictable.
- Uninstall command and Windows uninstaller remove Clawdash-created Claude hooks/auto-start entries when possible; warn about leftover local progress and offer a clear wipe command instead of silently deleting progress.
- No code-signing payment required to use the project; document SmartScreen/unsigned warnings transparently. Publish reproducible build instructions and checksums.

Web distribution: static build can be served without backend. PWA install/caching is useful but is not a substitute for initial asset download. Tests must verify that cached Arcade mode loads with the network disabled.

## 13. Security, privacy, and reliability

### Threat model

| Risk | Mitigation |
| --- | --- |
| Malicious website connects to local service | Loopback-only, Origin/Host enforcement, explicit pairing and secret auth |
| Spoofed agent event / replay | Authenticate emitters, event IDs, session-scoped ordering, deduplication and rate limits |
| Arbitrary command execution | Fixed allowlist of bridge commands and Git argv; no shell interpolation or UI-sourced command execution |
| Local Git contents or secrets disclosed | Metadata-only reader, bounded manifests, redact debug data, no raw Git data in exports |
| Symlink/path escape | Native-granted folder IDs, canonical roots, skip external symlink/submodule traversal |
| Untrusted level file causes resource abuse | Schema/version validation, hard caps on instances/length/string sizes, no executable fields |
| Game progress lost on crash | Atomic saves, versioned migrations, one-writer updates, backups |
| Claude Code blocked by integration | Silent success/no decisions from hook, tiny timeouts, no heavy operations in hook path |
| Private repo identified by shared challenge | Export baked level only; scrub fingerprint, SHA, path, filenames and metadata |
| Outdated/compromised assets/dependencies | Lockfile, license audit, dependency review and pinned CI |

Do not collect telemetry, crash reports, or analytics remotely. Any diagnostic logs are local, minimal, off by default or user-controlled, and redact tokens, commands, prompts and repository identities. Do not attach a listening interface to 0.0.0.0. Treat content read from Git manifests as **data**, never script.

### Failure behavior

- No Git available -> Arcade still works; Repo Run shows an actionable message.
- Not a repo / shallow history -> explicit supported fallback or friendly error; no crash.
- Invalid manifest -> ignore that manifest and continue with other metadata.
- Failed generator verification -> deterministic certified fallback.
- Bridge unavailable -> agent mode HUD shows disconnected; gameplay continues.
- Hook event malformed -> drop and log locally only if diagnostic mode enabled.
- Agent stops / crashes -> show turn ended/failed or session ended only when observed; after stale-timeout show "connection lost/unknown" rather than fabricated success.
- Storage migration fails -> preserve original backup, load read-only diagnostics rather than wiping silently.
- Audio fails/autoplay blocked -> gameplay works, user can re-enable sound with a gesture.

## 14. Testing strategy and quality gates

### Unit tests

- Fixed-tick trajectory, jump buffering, ground contact, side impacts, spike apex/edge hits, gaps, high-speed tunneling, death and respawn.
- Physics replay parity across Node/browser; stable golden simulation hashes.
- Level serialization/parsing/version rejection and import size caps.
- Canonical Git descriptor sorting, Unicode/path normalization, platform-independent seed and PRNG vectors.
- Pattern compatibility, certified witness replay, and deterministic compiler fallback.
- Hook normalization including SessionStart, UserPromptSubmit, Stop, StopFailure, permission/notification filtering and event ordering.
- Reducer deduplication, concurrency, stale-state handling and lack of fake "success".

### Property-based / generation tests

- For a large seeded fixture corpus across short, long, shallow, nested, monorepo and empty-ish Git repositories: generation terminates within budget, finishes exist, obstacles remain within bounds, every generated level has a passing continuous witness replay.
- Mutation tests for pattern boundary transitions and incompatible physics version.
- Stable output snapshots for identical Git fixture + version tuple across Windows and Linux.
- No generated challenge payload contains sentinel private filenames, paths, commit identifiers, or secret strings.

### Integration and end-to-end tests

- Fresh clone -> `pnpm install` -> `pnpm dev` -> select curated level -> start, jump, die, retry, save progress.
- Offline browser after PWA cache; no agent installed.
- Repo with fixed fixtures -> same checksum across consecutive runs and platforms.
- Bridge rejects missing/invalid token, foreign Origin, unexpected RPC and oversized payload; never binds externally.
- Install/remove hooks without overwriting a pre-existing user hook; malformed config recovery and idempotent reinstallation.
- Simulated Claude hook lifecycle -> open game (opt in), update HUD, needs-attention toast, turn-ended toast, preserve progress.
- Two overlapping agent sessions and bursty tool notifications do not duplicate windows or corrupt state.
- Windows clean VM with no Node installed: packaged app, bridge, hook CLI, opt-in auto-open, fullscreen/compact, uninstall.
- Keyboard navigation, small window rendering, focus behavior and reduced-motion verification.

### CI

GitHub Actions matrix:
- **ubuntu-latest:** TypeScript lint/typecheck/unit/property tests, web build and Playwright.
- **windows-latest:** simulator/generator parity, CLI/build packaging smoke, PowerShell/Windows hook and file-path fixtures.
- **Optional macOS:** after desktop support matures.

All pull requests should run format, typecheck, tests and license checks. Release pipeline builds versioned artifacts, runs clean-install smoke tests, and publishes checksums. Keep CI free within public-repo availability; never require a paid external service.

### Target budgets (tune via profiling)

- Stable **60 simulation ticks/sec** while visible and playing.
- Target **60 fps** rendering on ordinary integrated-graphics laptops; cap effects for compact or low-power mode.
- Avoid React renders per simulation tick.
- Hook emitter p95 under **100 ms** when service is available; short fail-open timeout when absent.
- Repo generator remains responsive on large repos by capping Git output, offloading work off the UI thread, and showing cancellable progress.
- Memory and startup budgets should be benchmarked on a 16 GB Windows laptop and documented before release.

## 15. Implementation phases and exit criteria

### Phase 1 — Build a game worth playing

1. Initialize pnpm workspace and shared TypeScript config; create React/Vite app and Phaser renderer.
2. Implement fixed-tick headless simulation, collision, input adapter, camera, replay and test suite.
3. Ship three **curated, playtested** levels, music/SFX and persistent Arcade scores.
4. Use **Astra** for functional menu/HUD/settings/results and visually polish the gameplay.
5. Add practice mode, themes, compact-responsive layout and accessibility options.

**Exit:** Browser app starts from a clone, works fully offline after installation/cache, plays three fun levels; physics and score persistence tests pass. No agent integration is necessary to enjoy it.

### Phase 2 — Repository levels

1. Git metadata-only reader with clear committed-snapshot policy.
2. Canonical descriptor/seed and cross-platform golden fixtures.
3. Certified segment catalog and stitched witness validation.
4. Generator, caching, difficulty mapping, Repo Run UI and fallback behavior.
5. Privacy and challenge-export redaction tests (export UI can wait).

**Exit:** Same snapshot/version produces the exact same beatable level and no source data leaves the device.

### Phase 3 — Claude Code

1. Normalized agent event contract/reducer with independent game state.
2. Safe CLI install/remove and best-effort nonblocking hooks.
3. Token-authenticated, loopback-only bridge and local pairing.
4. Agent Run HUD, optional auto-open, attention/finish notifications and concurrent sessions.
5. Windows lifecycle integration tests; ensure turn-ended is never displayed as verified task success.

**Exit:** Opt-in Claude prompt starts/opens Clawdash without blocking Claude; user can play, receive accurate attention/turn-finished notifications and retain progress.

### Phase 4 — Desktop, release, open source

1. Tauri 2 Windows packaging with standalone bundled bridge/hook emitter.
2. Single-instance, window focus policies, tray behavior and reliable clean startup/uninstall.
3. Build/release CI, checksums, real clean-VM testing.
4. README, clear install/troubleshooting/uninstall guides, CONTRIBUTING, SECURITY, LICENSE and asset license manifest.
5. Performance, accessibility, privacy and final game-feel pass.

**Exit:** Fresh Windows user can install, play, optionally connect Claude, disable/uninstall the integration, and use everything offline without a paid dependency.

## 16. Acceptance checklist

- [ ] A new contributor can clone, install dependencies and play Arcade immediately.
- [ ] Browser gameplay works without a desktop app, Git checkout or AI agent.
- [ ] Three original curated levels have gameplay reviews and passing tests.
- [ ] Jump/collision/death/respawn are precise, responsive and consistent.
- [ ] Percentage progress, attempts, practice checkpoints and normal/practice bests persist.
- [ ] Audio, themes, responsive compact/fullscreen and motion options work.
- [ ] Repo Run uses only approved metadata, documents HEAD snapshot behavior, and is deterministic.
- [ ] All generated levels have a passing complete witness replay and finite fallback path.
- [ ] Claude hook installation is opt-in, safe, idempotent and reversible.
- [ ] Auto-open/activate occurs on prompt when enabled without blocking or modifying Claude Code.
- [ ] Attention, turn-ended, turn-failed and session-ended semantics are correct.
- [ ] Browser-origin and token-based spoofed events are rejected.
- [ ] The app still functions if the bridge or Claude Code is absent.
- [ ] Windows release installs and runs without paid APIs, required accounts or separately installed Node.
- [ ] All code and redistributed assets have auditable, compatible licenses.
- [ ] **Astra is used for UI development**, but no Astra/AI call occurs at runtime.
- [ ] Unit, property, integration, browser and Windows smoke tests pass.

## 17. Initial engineering decisions (ADRs)

**ADR-001 — Gameplay first.** Complete and tune the browser game before investing in advanced agent providers.

**ADR-002 — Headless authoritative simulation.** Phaser is the rendering/audio framework; the deterministic TS simulation is the single gameplay authority. No duplicated Phaser physics state.

**ADR-003 — Committed-snapshot Git levels.** v1 is derived from HEAD, not arbitrary dirty worktree contents, to preserve strong reproducibility and metadata-only inspection.

**ADR-004 — Constructively validated levels.** Select from certified segments, replay a continuous witness and use a known-safe deterministic fallback.

**ADR-005 — Provider-neutral events.** Hook adapters normalize lifecycle signals. An agent's Stop event is not a verified code-success event.

**ADR-006 — Local-first security.** Only user-authorized local folder grants and authenticated loopback transport; no public backend or tracking.

**ADR-007 — Windows packaging without runtime prerequisites.** A standalone bridge/hook emitter is mandatory for the release app, even if developer tooling needs Node.

**ADR-008 — Astra-authored UI, zero-AI runtime.** Use Astra in design/implementation. The shipped game remains entirely static/local.

**ADR-009 — Cost discipline.** No paid SDK/API, backend hosting, analytics subscription, or proprietary redistributed audio. Optional GitHub static hosting is not a dependency.

## 18. Source references for implementers

Consult vendor documentation before implementing integration details. These URLs are references, not runtime dependencies.

- Claude Code documented hooks and lifecycle: https://code.claude.com/docs/en/hooks
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Phaser 3 Arcade Physics fixed-step reference (for contrast with our custom authoritative simulation): https://docs.phaser.io/phaser/concepts/physics/arcade
- Tauri 2 sidecars: https://v2.tauri.app/develop/sidecar/
- Tauri 2 single-instance plugin: https://v2.tauri.app/plugin/single-instance/
- Tauri shell permissions/scoping: https://v2.tauri.app/reference/javascript/shell/

---

**Guiding rule:** The platformer is the product. Repo generation provides replayable variety, and agent integration makes it convenient to launch. Neither integration should make gameplay less fun, slower, less secure, or dependent on external infrastructure.
