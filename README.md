# swarm-discussion-installer

Tiny installer and doctor for the `swarm-discussion` Codex plugin.

The Codex plugin package includes `agents/swarm-expert.toml`, but Codex custom agents are discovered from
standalone agent directories, not from the plugin package internals. This wrapper installs the plugin through
the native Codex plugin commands, then copies `swarm-expert.toml` from the installed plugin directory into the
expected custom-agent location.

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
- global custom-agent file.
- project custom-agent file.
- TOML `name = "swarm-expert"`.
- file hash equality with the template from the installed `swarm-discussion` plugin.

Optional real spawn smoke test:

```sh
npx @automann/swarm-discussion-installer doctor --verify-spawn
```

This may consume a Codex model call, so it is opt-in.

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
