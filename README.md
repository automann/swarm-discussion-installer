# swarm-discussion-installer

Tiny installer and doctor for the `swarm-discussion` Codex plugin.

The Codex plugin package includes `agents/swarm-expert.toml`, but Codex custom agents are discovered from
standalone agent directories, not from the plugin package internals. This wrapper installs the plugin through
the native Codex plugin commands, then copies `swarm-expert.toml` from the installed plugin directory into the
expected custom-agent location.

The plugin also carries its own bundled runtime. The installer verifies that bundled runtime through
`runtime/swarm_runtime_wrapper.py doctor`; it does not install or manage a global `swarm-rt` command.

## Install Globally

```sh
npx @automann/swarm-discussion-installer install --global
```

This runs:

```sh
codex plugin marketplace add automann/swarm-discussion
codex plugin add swarm-discussion@swarm-discussion
```

Then it writes:

```text
~/.codex/agents/swarm-expert.toml
```

## Install For A Project

```sh
npx @automann/swarm-discussion-installer install --project
```

This writes:

```text
./.codex/agents/swarm-expert.toml
```

Run this command from the project root.

## Doctor

```sh
npx @automann/swarm-discussion-installer doctor
```

The doctor command does not modify files. It checks:

- Codex CLI availability and version.
- `swarm-discussion@swarm-discussion` plugin installed and enabled.
- bundled plugin runtime contract compatibility.
- global custom-agent file.
- project custom-agent file.
- TOML `name = "swarm-expert"`.
- file hash equality with the template from the installed `swarm-discussion` plugin.

Optional real spawn smoke test:

```sh
npx @automann/swarm-discussion-installer doctor --verify-spawn
```

This may consume a Codex model call, so it is opt-in.

## Repair

```sh
npx @automann/swarm-discussion-installer repair --global
```

or:

```sh
npx @automann/swarm-discussion-installer repair --project
```

`repair` reruns the native Codex plugin install/update commands, reads the current
`agents/swarm-expert.toml` from the installed plugin, and rewrites the selected custom-agent target when it is
missing or stale. It uses the same overwrite policy as `install`.

## Uninstall Custom-Agent Registration

```sh
npx @automann/swarm-discussion-installer uninstall --global
```

or:

```sh
npx @automann/swarm-discussion-installer uninstall --project
```

`uninstall` only removes the `swarm-expert.toml` custom-agent registration file. It does not remove the Codex
plugin or marketplace.

The command is conservative:

- target missing: succeeds as already absent.
- target matches the installed plugin template: removes it.
- target differs from the installed plugin template: refuses to remove it.

To remove a modified file anyway:

```sh
npx @automann/swarm-discussion-installer uninstall --global --backup --force
```

## Clean Uninstall

```sh
npx @automann/swarm-discussion-installer uninstall --global --all
```

or:

```sh
npx @automann/swarm-discussion-installer uninstall --project --all
```

`--all` is intentionally destructive and does not create backups. It removes:

- the selected custom-agent registration file.
- the `swarm-discussion@swarm-discussion` Codex plugin.
- the `swarm-discussion` Codex marketplace.

Use `--global --all` to remove `~/.codex/agents/swarm-expert.toml`. Use `--project --all` from a project root to
remove `./.codex/agents/swarm-expert.toml`.

## Overwrite Policy

The installer is idempotent and refuses to silently overwrite a different existing agent file.

Use a backup:

```sh
npx @automann/swarm-discussion-installer install --global --backup
```

Force overwrite without a backup:

```sh
npx @automann/swarm-discussion-installer install --global --force
```

## Manual Fallback

Manual copy is a troubleshooting path, not the normal install path:

```sh
mkdir -p ~/.codex/agents
cp /path/to/installed/swarm-discussion/plugins/codex/agents/swarm-expert.toml ~/.codex/agents/swarm-expert.toml
```

You can find the installed plugin path with:

```sh
codex plugin list | rg swarm-discussion@swarm-discussion
```
