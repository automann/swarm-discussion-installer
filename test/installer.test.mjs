import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  AGENT_NAME,
  backupPathFor,
  inspectAgentFile,
  parseArgs,
  parsePluginList,
  pluginAgentPath,
  registerAgent,
  targetAgentPath,
  uninstallAgent,
  validateAgentSource
} from "../lib/installer.mjs";

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "swarm-installer-test-"));
}

const TEST_AGENT_TOML = `name = "swarm-expert"
description = "Embodies a swarm-discussion persona/role supplied at spawn time; returns only the requested JSON."
developer_instructions = """
You are ONE participant in a structured swarm-discussion.
"""
`;

function writePluginAgent(root = tempDir(), text = TEST_AGENT_TOML) {
  const file = pluginAgentPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

test("plugin swarm-expert template is valid", () => {
  const source = writePluginAgent();
  const result = validateAgentSource(source);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.fields.name, AGENT_NAME);
  assert.ok(result.fields.description);
  assert.ok(result.fields.developer_instructions.includes("structured swarm-discussion"));
});

test("registerAgent creates a global target under CODEX_HOME", () => {
  const root = tempDir();
  const source = writePluginAgent();
  const result = registerAgent({ scope: "global", codexHome: root, sourceFile: source });
  const target = targetAgentPath({ scope: "global", codexHome: root });

  assert.equal(result.action, "created");
  assert.equal(result.target, target);
  assert.equal(readFileSync(target, "utf8"), readFileSync(source, "utf8"));
});

test("registerAgent is idempotent when target matches", () => {
  const root = tempDir();
  const source = writePluginAgent();
  registerAgent({ scope: "global", codexHome: root, sourceFile: source });
  const second = registerAgent({ scope: "global", codexHome: root, sourceFile: source });

  assert.equal(second.action, "already-installed");
});

test("registerAgent refuses to overwrite a different target by default", () => {
  const root = tempDir();
  const target = targetAgentPath({ scope: "global", codexHome: root });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'name = "swarm-expert"\ndescription = "custom"\ndeveloper_instructions = """custom"""\n', {
    flag: "wx"
  });

  assert.throws(
    () => registerAgent({ scope: "global", codexHome: root, sourceFile: writePluginAgent() }),
    /Refusing to overwrite existing custom agent file/
  );
});

test("registerAgent backs up a different target before overwriting", () => {
  const root = tempDir();
  const target = targetAgentPath({ scope: "global", codexHome: root });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'name = "swarm-expert"\ndescription = "custom"\ndeveloper_instructions = """custom"""\n', {
    flag: "wx"
  });

  const source = writePluginAgent();
  const result = registerAgent({ scope: "global", codexHome: root, sourceFile: source, backup: true });
  assert.equal(result.action, "backed-up-and-overwritten");
  assert.ok(result.backupFile);
  assert.equal(existsSync(result.backupFile), true);
  assert.equal(readFileSync(target, "utf8"), readFileSync(source, "utf8"));
});

test("uninstallAgent removes a target that matches the plugin template", () => {
  const root = tempDir();
  const source = writePluginAgent();
  registerAgent({ scope: "global", codexHome: root, sourceFile: source });
  const target = targetAgentPath({ scope: "global", codexHome: root });

  const result = uninstallAgent({ scope: "global", codexHome: root, sourceFile: source });
  assert.equal(result.action, "removed");
  assert.equal(result.target, target);
  assert.equal(existsSync(target), false);
});

test("uninstallAgent is idempotent when target is absent", () => {
  const root = tempDir();
  const result = uninstallAgent({ scope: "global", codexHome: root, sourceFile: writePluginAgent() });

  assert.equal(result.action, "already-absent");
});

test("uninstallAgent refuses to remove a different target by default", () => {
  const root = tempDir();
  const source = writePluginAgent();
  const target = targetAgentPath({ scope: "global", codexHome: root });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'name = "swarm-expert"\ndescription = "custom"\ndeveloper_instructions = """custom"""\n');

  assert.throws(
    () => uninstallAgent({ scope: "global", codexHome: root, sourceFile: source }),
    /Refusing to remove custom agent file/
  );
  assert.equal(existsSync(target), true);
});

test("uninstallAgent can force remove a different target and keep a backup", () => {
  const root = tempDir();
  const source = writePluginAgent();
  const target = targetAgentPath({ scope: "global", codexHome: root });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'name = "swarm-expert"\ndescription = "custom"\ndeveloper_instructions = """custom"""\n');

  const result = uninstallAgent({ scope: "global", codexHome: root, sourceFile: source, force: true, backup: true });
  assert.equal(result.action, "force-removed");
  assert.equal(existsSync(target), false);
  assert.ok(result.backupFile);
  assert.equal(existsSync(result.backupFile), true);
});

test("inspectAgentFile reports hash equality and expected name", () => {
  const root = tempDir();
  const target = targetAgentPath({ scope: "project", projectRoot: root });
  const source = writePluginAgent();
  registerAgent({ scope: "project", projectRoot: root, sourceFile: source });

  const inspected = inspectAgentFile(target, source);
  assert.equal(inspected.exists, true);
  assert.equal(inspected.sameAsSource, true);
  assert.equal(inspected.declaresExpectedName, true);
});

test("pluginAgentPath points at the installed plugin agent template", () => {
  assert.equal(
    pluginAgentPath("/Users/example/.codex/.tmp/marketplaces/swarm-discussion/plugins/codex"),
    "/Users/example/.codex/.tmp/marketplaces/swarm-discussion/plugins/codex/agents/swarm-expert.toml"
  );
});

test("parsePluginList finds installed plugin rows", () => {
  const output = `
Marketplace \`swarm-discussion\`
/Users/example/.codex/.tmp/marketplaces/swarm-discussion/.agents/plugins/marketplace.json

PLUGIN                             STATUS              VERSION  PATH
swarm-discussion@swarm-discussion  installed, enabled  0.1.5    /Users/example/.codex/.tmp/marketplaces/swarm-discussion/plugins/codex
`;

  const parsed = parsePluginList(output);
  assert.equal(parsed.found, true);
  assert.equal(parsed.installed, true);
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.version, "0.1.5");
});

test("parseArgs rejects multiple install scopes", () => {
  assert.throws(
    () => parseArgs(["install", "--global", "--project"]),
    /Choose exactly one install scope/
  );
});

test("parseArgs rejects verify-spawn for uninstall", () => {
  assert.throws(
    () => parseArgs(["uninstall", "--global", "--verify-spawn"]),
    /uninstall does not support --verify-spawn/
  );
});

test("backupPathFor uses timestamped suffix", () => {
  const file = "/tmp/swarm-expert.toml";
  const backup = backupPathFor(file, new Date("2026-06-08T09:30:00.000Z"));
  assert.equal(backup, "/tmp/swarm-expert.toml.bak.20260608T093000Z");
});
