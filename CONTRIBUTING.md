# Contributing

Read ARCHITECTURE.md and docs/implementation-contract.md. Keep simulation headless and deterministic, renderer interpolation cosmetic, private repository descriptors outside UI/export payloads, and normal/practice scores independent.

Use Node 22 and the pinned pnpm version. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm exec prettier --check .`, `node scripts/check-licenses.mjs`, and browser tests before submitting a PR. New pattern geometry must carry a continuous witness under the shipping physics version. Physics changes require a new version and deliberate golden fixture migration.

Do not add telemetry, runtime AI, network assets, arbitrary browser commands, hosted backends or proprietary assets. Test hooks only against temporary settings directories. Avoid installing integration hooks on contributor machines from tests. Each feature gets a reviewable PR with validation evidence.
