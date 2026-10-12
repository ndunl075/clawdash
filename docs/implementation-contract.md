# Implementation contract

Read ARCHITECTURE.md in full. All application imports use relative paths to package source (no workspace aliases necessary). Root owns package.json, lockfile, configs and integration. Each worker commits its isolated branch; never push or merge another branch.

## Gameplay API (owned by game stream)

`packages/level-schema/src/index.ts`: export LevelSpec, LevelChunk, Obstacle, parseLevel. LevelSpec matches architecture §6. Coordinates use **pixels**, y is altitude above ground; simulation uses fixed-point integers internally. Standard player 28px square, start x=0,y=0, speed 4px/tick, gravity 0.65px/tick², jump 11px/tick (tune together within simulation version). Obstacles spike/block/platform/gap use x,y,width,height in pixels. Gap removes ground over its horizontal interval. A platform y is its top altitude. Ground default y=0.

`packages/game/src/simulation/index.ts`: export PHYSICS_VERSION; createRun(level, practice=false); stepRun(level,state,input); restartRun(level,state); setCheckpoint(level,state); restoreCheckpoint(level,state). Input {jumpPressed:boolean,jumpHeld:boolean}. RunState fields tick,x,y,vy,grounded,status ('playing'|'dead'|'completed'),attempt,progress,practice; checkpoint optional. Returned states are immutable. Pause handled by host not stepping.

`packages/level-content/src/index.ts`: export curatedLevels: LevelSpec[] (three), certifiedPatterns, compilePatterns(patternIds, options), witnessForLevel(level): number[] jump press ticks, verifyLevel(level): {valid:boolean,ticks:number}. Generator consumes these. Level audio uses locally synthesized patches. Witness is separate from serialized level; derive from pattern/chunk references.

## Agent/bridge API (owned by integration stream)

`packages/agent-core/src/index.ts`: AgentEvent, AgentSession, createAgentState(), reduceAgentEvent(state,event), getSessions(state). Architecture semantics mandatory.

Bridge serves same-origin local static game, authenticated JSON HTTP `/rpc` and `/events` polling (equivalent stream allowed), bearer header never URL. `health`, `listSessions`, `inspectRepo`, `generateRepoLevel`; folderGrantId only. CLI grants user selected paths. Root implements generator `packages/level-generator/src/index.ts`: async inspectRepository(path), generateRepoLevel(descriptor,difficulty?): LevelSpec. Bridge can import these functions once delivered. No raw descriptor returns to browser: return public summary only.

## UI stream (Astra)

Own apps/web/, packages/ui/, packages/game/src/renderer/, packages/game/src/audio/, apps/web/src/storage/. Use APIs above. May add wrappers to adapt at integration, never change simulation or contracts. Agent connection HTTP authenticated client; pairing explicitly entered by user, local companion same-origin preferred. UI must run standalone without bridge. React shell + Phaser renderer, Web Audio local synthesis. Keep menu keyboard accessible and game input isolated from buttons. Include opt-in PWA caching. Add meaningful browser E2E tests under tests/e2e/ (root owns Playwright config).

## Ownership

Core: packages/level-schema/, packages/game/src/simulation/, packages/game/src/replay/, packages/level-content/ and tests/fixtures/.
UI: apps/web/, packages/ui/, game renderer/audio/, tests/e2e/.
Integration: packages/agent-core/, packages/agent-adapters/, packages/local-bridge/, packages/cli/, packages/storage/, tests/integration/agent* and bridge*.
Root: generator, desktop, CI/release/docs/configuration and final review.

All streams add focused tests and document unresolved requirements truthfully. No hosted services, runtime AI, telemetry, copyrighted assets or hook installation on the developer machine.
