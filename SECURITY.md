# Security and privacy

Clawdash has no hosted backend, telemetry or accounts. Source files, agent prompts/transcripts and tool arguments are never sent to the game. Repo inspection is committed metadata plus bounded allowlisted dependency fields. Challenge exports contain only baked gameplay geometry.

The companion binds 127.0.0.1, checks Host/Origin, and requires a header bearer secret for every privileged endpoint. Browser paths are replaced with explicit native/CLI folder grants. Pairing is opt-in and revocable. Runtime discovery has no token; per-user secrets are stored separately. A process already compromised under your OS account is outside this boundary.

Git inspection clears inherited Git overrides, disables configured filesystem monitors, blocks lazy object fetching and all transport protocols, and ignores submodule working-tree traversal. Incomplete clones fail rather than generating an availability-dependent seed. The process controls follow the [official Git environment documentation](https://git-scm.com/docs/git).

Report vulnerabilities privately through GitHub's security reporting for this repository where enabled. Do not include secrets or raw private repo metadata in issues. Stop the bridge, revoke pairing and uninstall Clawdash-owned hooks to disable integration. See docs/windows.md for recovery.
