# Smoke Tests

This file records the clean-install checks for the Codex plugin installer. Use
an isolated `CODEX_HOME` for plugin and marketplace state so the smoke does not
touch a developer's real Codex install.

## Isolated Project Install

```sh
SMOKE_ROOT=$(mktemp -d /tmp/swarm-installer-smoke.XXXXXX)
mkdir -p "$SMOKE_ROOT/codex-home" "$SMOKE_ROOT/workspace"

cd "$SMOKE_ROOT/workspace"
CODEX_HOME="$SMOKE_ROOT/codex-home" \
  node /path/to/swarm-discussion-installer/bin/swarm-discussion-installer.mjs install --project

CODEX_HOME="$SMOKE_ROOT/codex-home" \
  node /path/to/swarm-discussion-installer/bin/swarm-discussion-installer.mjs doctor
```

Expected checks:

- `swarm-discussion@swarm-discussion` installed and enabled.
- `plugin swarm-expert template is valid`.
- `plugin bundled runtime is valid`, including the bundled minimal fixture
  smoke.
- `project custom agent installed`.
- `effective custom agent`.

## Clean Uninstall

```sh
cd "$SMOKE_ROOT/workspace"
CODEX_HOME="$SMOKE_ROOT/codex-home" \
  node /path/to/swarm-discussion-installer/bin/swarm-discussion-installer.mjs uninstall --project --all
```

Expected result:

- project `swarm-expert.toml` removed.
- Codex plugin removed.
- Codex marketplace removed.
- `codex plugin list` reports no marketplace plugins for the isolated
  `CODEX_HOME`.

## Real Spawn Smoke

`--verify-spawn` uses `codex exec` and requires an authenticated Codex home.
It is expected to fail with `401 Unauthorized` when run against a freshly
created isolated `CODEX_HOME` with no login state.

Run it only with a Codex home that is already logged in:

```sh
npx @automann/swarm-discussion-installer doctor --verify-spawn
```

Keep this as an opt-in smoke because it can consume a model call.
