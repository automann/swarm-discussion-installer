import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  AGENT_NAME,
  RUNTIME_COMPATIBILITY,
  RUNTIME_OVERRIDE_ENV,
  backupPathFor,
  inspectAgentFile,
  listPluginCacheVersions,
  parseArgs,
  parsePluginList,
  parseRuntimeDoctorOutput,
  pluginAgentPath,
  pluginCacheRoot,
  pluginRuntimeWrapperPath,
  registerAgent,
  removeCodexPluginAndMarketplace,
  resolveInstalledPluginRoot,
  runBundledRuntimeDoctor,
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

test("uninstallAgent can force remove a different target without a source template", () => {
  const root = tempDir();
  const target = targetAgentPath({ scope: "global", codexHome: root });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'name = "swarm-expert"\ndescription = "custom"\ndeveloper_instructions = """custom"""\n');

  const result = uninstallAgent({ scope: "global", codexHome: root, force: true });
  assert.equal(result.action, "force-removed");
  assert.equal(existsSync(target), false);
  assert.equal(result.backupFile, null);
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

test("pluginRuntimeWrapperPath points at the installed plugin runtime wrapper", () => {
  assert.equal(
    pluginRuntimeWrapperPath("/Users/example/.codex/plugins/cache/swarm-discussion/swarm-discussion/0.1.5"),
    "/Users/example/.codex/plugins/cache/swarm-discussion/swarm-discussion/0.1.5/runtime/swarm_runtime_wrapper.py"
  );
});

test("pluginCacheRoot points at the Codex versioned plugin cache", () => {
  assert.equal(
    pluginCacheRoot({ codexHome: "/Users/example/.codex", version: "0.1.5" }),
    "/Users/example/.codex/plugins/cache/swarm-discussion/swarm-discussion/0.1.5"
  );
});

test("resolveInstalledPluginRoot prefers the exact versioned cache root", () => {
  const codexHome = tempDir();
  const root = pluginCacheRoot({ codexHome, version: "0.1.5" });
  mkdirSync(root, { recursive: true });

  const resolved = resolveInstalledPluginRoot({
    codexHome,
    pluginStatus: {
      version: "0.1.5",
      path: "/Users/example/.codex/.tmp/marketplaces/swarm-discussion/plugins/codex"
    }
  });

  assert.equal(resolved.pluginRoot, root);
  assert.equal(resolved.rootKind, "cache");
  assert.equal(resolved.exactCacheExists, true);
});

test("resolveInstalledPluginRoot detects stale cache versions", () => {
  const codexHome = tempDir();
  mkdirSync(pluginCacheRoot({ codexHome, version: "0.1.4" }), { recursive: true });

  const resolved = resolveInstalledPluginRoot({
    codexHome,
    pluginStatus: {
      version: "0.1.5",
      path: "/Users/example/.codex/.tmp/marketplaces/swarm-discussion/plugins/codex"
    }
  });

  assert.equal(resolved.rootKind, "marketplace");
  assert.equal(resolved.exactCacheExists, false);
  assert.equal(resolved.cacheVersionMismatch, true);
  assert.deepEqual(resolved.cacheVersions, ["0.1.4"]);
  assert.deepEqual(resolved.staleCacheVersions, ["0.1.4"]);
});

test("listPluginCacheVersions sorts semver-like cache directories", () => {
  const codexHome = tempDir();
  for (const version of ["0.1.10", "0.1.2", "0.1.9"]) {
    mkdirSync(pluginCacheRoot({ codexHome, version }), { recursive: true });
  }

  assert.deepEqual(listPluginCacheVersions(codexHome), ["0.1.2", "0.1.9", "0.1.10"]);
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
  assert.equal(parsed.path, "/Users/example/.codex/.tmp/marketplaces/swarm-discussion/plugins/codex");
});

test("parseRuntimeDoctorOutput accepts a compatible bundled runtime", () => {
  const parsed = parseRuntimeDoctorOutput(JSON.stringify({
    ok: true,
    wrapper: { compatibility: RUNTIME_COMPATIBILITY },
    runtime: { source: "bundled" },
    fixtureSmoke: { ok: true },
    contractSummary: { commandCount: 16 }
  }));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.compatible, true);
  assert.equal(parsed.source, "bundled");
  assert.equal(parsed.fixtureSmokeOk, true);
});

test("runBundledRuntimeDoctor verifies the plugin runtime wrapper", () => {
  const pluginRoot = tempDir();
  const wrapper = pluginRuntimeWrapperPath(pluginRoot);
  mkdirSync(path.dirname(wrapper), { recursive: true });
  writeFileSync(wrapper, "# fake wrapper\n");

  const checked = runBundledRuntimeDoctor({
    pluginRoot,
    runner(command, args, options) {
      assert.equal(command, "python3");
      assert.deepEqual(args, [wrapper, "doctor", "--smoke-fixture"]);
      assert.equal(options.cwd, pluginRoot);
      assert.equal(Object.hasOwn(options.env, RUNTIME_OVERRIDE_ENV), false);
      return {
        command,
        args,
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          ok: true,
          wrapper: { compatibility: RUNTIME_COMPATIBILITY },
          runtime: { source: "bundled" },
          fixtureSmoke: { ok: true, summary: { health: "on-track" } },
          contractSummary: { commandCount: 16 }
        }),
        stderr: "",
        error: null,
        ok: true
      };
    }
  });

  assert.equal(checked.ok, true);
  assert.match(checked.detail, /bundled swarm-runtime-v2-alpha/);
  assert.match(checked.detail, /fixture on-track/);
});

test("runBundledRuntimeDoctor rejects non-bundled runtime sources", () => {
  const pluginRoot = tempDir();
  const wrapper = pluginRuntimeWrapperPath(pluginRoot);
  mkdirSync(path.dirname(wrapper), { recursive: true });
  writeFileSync(wrapper, "# fake wrapper\n");

  const checked = runBundledRuntimeDoctor({
    pluginRoot,
    runner(command, args) {
      return {
        command,
        args,
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          ok: true,
          wrapper: { compatibility: RUNTIME_COMPATIBILITY },
          runtime: { source: "PATH" },
          fixtureSmoke: { ok: true, summary: { health: "on-track" } },
          contractSummary: { commandCount: 16 }
        }),
        stderr: "",
        error: null,
        ok: true
      };
    }
  });

  assert.equal(checked.ok, false);
  assert.match(checked.detail, /expected bundled runtime source/);
});

test("runBundledRuntimeDoctor rejects a failed fixture smoke", () => {
  const pluginRoot = tempDir();
  const wrapper = pluginRuntimeWrapperPath(pluginRoot);
  mkdirSync(path.dirname(wrapper), { recursive: true });
  writeFileSync(wrapper, "# fake wrapper\n");

  const checked = runBundledRuntimeDoctor({
    pluginRoot,
    runner(command, args) {
      return {
        command,
        args,
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          ok: false,
          wrapper: { compatibility: RUNTIME_COMPATIBILITY },
          runtime: { source: "bundled" },
          fixtureSmoke: { ok: false, errors: [{ code: "missing_host_step" }] },
          contractSummary: { commandCount: 16 }
        }),
        stderr: "",
        error: null,
        ok: false
      };
    }
  });

  assert.equal(checked.ok, false);
  assert.match(checked.detail, /runtime doctor reported failure|fixture smoke failed/);
});

test("runBundledRuntimeDoctor reports a missing wrapper", () => {
  const checked = runBundledRuntimeDoctor({ pluginRoot: tempDir() });

  assert.equal(checked.ok, false);
  assert.match(checked.detail, /missing wrapper/);
});

test("parseArgs rejects multiple install scopes", () => {
  assert.throws(
    () => parseArgs(["install", "--global", "--project"]),
    /Choose exactly one install scope/
  );
});

test("parseArgs accepts clean uninstall", () => {
  const parsed = parseArgs(["uninstall", "--project", "--all"]);
  assert.equal(parsed.command, "uninstall");
  assert.equal(parsed.scope, "project");
  assert.equal(parsed.all, true);
  assert.equal(parsed.backup, false);
});

test("parseArgs rejects clean uninstall with backup", () => {
  assert.throws(
    () => parseArgs(["uninstall", "--project", "--all", "--backup"]),
    /uninstall --all does not support --backup/
  );
});

test("parseArgs rejects --all outside uninstall", () => {
  assert.throws(
    () => parseArgs(["install", "--global", "--all"]),
    /--all is only supported by uninstall/
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

test("removeCodexPluginAndMarketplace removes plugin before marketplace", () => {
  const calls = [];
  const results = removeCodexPluginAndMarketplace({
    codexBin: "codex",
    cwd: "/tmp/swarm-clean",
    runner(command, args, options) {
      calls.push({ command, args, options });
      return {
        command,
        args,
        status: 0,
        signal: null,
        stdout: "",
        stderr: "",
        error: null,
        ok: true
      };
    }
  });

  assert.deepEqual(calls.map((call) => call.args), [
    ["plugin", "remove", "swarm-discussion@swarm-discussion"],
    ["plugin", "marketplace", "remove", "swarm-discussion"]
  ]);
  assert.equal(calls.every((call) => call.command === "codex"), true);
  assert.equal(calls.every((call) => call.options.cwd === "/tmp/swarm-clean"), true);
  assert.equal(results.every((step) => step.result.ok), true);
});

test("removeCodexPluginAndMarketplace treats an absent marketplace as idempotent", () => {
  const results = removeCodexPluginAndMarketplace({
    runner(command, args) {
      if (args.join(" ") === "plugin marketplace remove swarm-discussion") {
        return {
          command,
          args,
          status: 1,
          signal: null,
          stdout: "",
          stderr: "Error: marketplace `swarm-discussion` is not configured or installed",
          error: null,
          ok: false
        };
      }
      return {
        command,
        args,
        status: 0,
        signal: null,
        stdout: "",
        stderr: "",
        error: null,
        ok: true
      };
    }
  });

  assert.equal(results[0].idempotent, false);
  assert.equal(results[1].idempotent, true);
});
