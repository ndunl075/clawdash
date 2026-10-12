# Original assets and dependency licenses

Clawdash geometry, cube character, palettes, particles, interface and locally synthesized musical patches/SFX are original project code under the root MIT license. No Geometry Dash artwork, music, levels, fonts or other assets are redistributed. Audio is synthesized locally; no network audio service is used. System fonts are requested without bundling font files.

React, Phaser, Vite, TypeScript, Zod and the Tauri JavaScript API use MIT-compatible licensing. Tauri and its official Rust plugins are MIT OR Apache-2.0. Node.js carries its upstream license and third-party notices; release installers that embed a Node SEA must include the Node distribution LICENSE alongside the executable. `scripts/check-licenses.mjs` audits installed JavaScript package manifests; Rust transitive notices are generated/reviewed during release, not inferred from a direct dependency license.

Before publishing a release, retain upstream notices for all redistributed binaries and review the actual Cargo.lock and pnpm-lock.yaml. No paid or proprietary audio/image dependency is required.

`collect-notices.mjs` includes matching Node notices, JavaScript notices, Rust license declarations with exact crate source URLs, and the full unmodified source of MPL-2.0 crates alongside the installer resources. Dual-licensed crates are used under their MIT/Apache-compatible option. caniuse-lite build data carries CC-BY-4.0 attribution in its collected upstream notices. Do not remove the generated licenses directory when redistributing the companion or installer.

The separately downloaded `nsis-tauri-utils` v0.5.3 helper is used under its MIT option; its complete release-tag notice and [versioned source provenance](https://github.com/tauri-apps/nsis-tauri-utils/tree/nsis_tauri_utils-v0.5.3) are appended to bundled notices. Keep this helper notice aligned with Tauri CLI upgrades.
