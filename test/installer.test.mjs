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
  registerAgent,
  sourceAgentPath,
  targetAgentPath,
  validateAgentTemplate
} from "../lib/installer.mjs";

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "swarm-installer-test-"));
}

test("bundled swarm-expert template is valid", () => {
  const result = validateAgentTemplate();
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.fields.name, AGENT_NAME);
  assert.ok(result.fields.description);
  assert.ok(result.fields.developer_instructions.includes("structured swarm-discussion"));
});

test("registerAgent creates a global target under CODEX_HOME", () => {
  const root = tempDir();
  const result = registerAgent({ scope: "global", codexHome: root });
  const target = targetAgentPath({ scope: "global", codexHome: root });

  assert.equal(result.action, "created");
  assert.equal(result.target, target);
  assert.equal(readFileSync(target, "utf8"), readFileSync(sourceAgentPath(), "utf8"));
});

test("registerAgent is idempotent when target matches", () => {
  const root = tempDir();
  registerAgent({ scope: "global", codexHome: root });
  const second = registerAgent({ scope: "global", codexHome: root });

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
    () => registerAgent({ scope: "global", codexHome: root }),
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

  const result = registerAgent({ scope: "global", codexHome: root, backup: true });
  assert.equal(result.action, "backed-up-and-overwritten");
  assert.ok(result.backupFile);
  assert.equal(existsSync(result.backupFile), true);
  assert.equal(readFileSync(target, "utf8"), readFileSync(sourceAgentPath(), "utf8"));
});

test("inspectAgentFile reports hash equality and expected name", () => {
  const root = tempDir();
  const target = targetAgentPath({ scope: "project", projectRoot: root });
  registerAgent({ scope: "project", projectRoot: root });

  const inspected = inspectAgentFile(target);
  assert.equal(inspected.exists, true);
  assert.equal(inspected.sameAsSource, true);
  assert.equal(inspected.declaresExpectedName, true);
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

test("backupPathFor uses timestamped suffix", () => {
  const file = "/tmp/swarm-expert.toml";
  const backup = backupPathFor(file, new Date("2026-06-08T09:30:00.000Z"));
  assert.equal(backup, "/tmp/swarm-expert.toml.bak.20260608T093000Z");
});
