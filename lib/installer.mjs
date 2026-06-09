import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@automann/swarm-discussion-installer";
export const MARKETPLACE_REPO = "automann/swarm-discussion";
export const MARKETPLACE_NAME = "swarm-discussion";
export const PLUGIN_ID = "swarm-discussion@swarm-discussion";
export const AGENT_NAME = "swarm-expert";
export const RUNTIME_COMPATIBILITY = "swarm-runtime-v2-alpha";
export const RUNTIME_OVERRIDE_ENV = "SWARM_DISCUSSION_RUNTIME";

const OK = "OK";
const WARN = "WARN";
const FAIL = "FAIL";
const SKIPPED = "SKIPPED";

export class InstallerError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "InstallerError";
    this.details = details;
  }
}

export function packageRoot() {
  return fileURLToPath(new URL("../", import.meta.url));
}

export function pluginAgentPath(pluginRoot) {
  return pluginRoot ? path.join(pluginRoot, "agents", `${AGENT_NAME}.toml`) : null;
}

export function pluginRuntimeWrapperPath(pluginRoot) {
  return pluginRoot ? path.join(pluginRoot, "runtime", "swarm_runtime_wrapper.py") : null;
}

export function defaultCodexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function targetAgentPath({ scope, projectRoot = process.cwd(), codexHome = defaultCodexHome() }) {
  if (scope === "global") {
    return path.join(codexHome, "agents", `${AGENT_NAME}.toml`);
  }
  if (scope === "project") {
    return path.join(projectRoot, ".codex", "agents", `${AGENT_NAME}.toml`);
  }
  throw new InstallerError(`Unknown install scope: ${scope}`);
}

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(file) {
  return sha256Text(readFileSync(file, "utf8"));
}

export function readTextIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

export function parseAgentToml(text) {
  const scalar = (key) => {
    const m = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
    return m ? m[1] : null;
  };
  const triple = (key) => {
    const m = text.match(new RegExp(`^${key}\\s*=\\s*"""([\\s\\S]*?)"""`, "m"));
    return m ? m[1] : null;
  };
  return {
    name: scalar("name"),
    description: scalar("description"),
    developer_instructions: triple("developer_instructions")
  };
}

export function validateAgentSource(file) {
  if (!file) {
    return { ok: false, file, errors: ["agent template path is unavailable"] };
  }
  if (!existsSync(file)) {
    return { ok: false, file, errors: [`agent template not found: ${file}`] };
  }
  const text = readFileSync(file, "utf8");
  const fields = parseAgentToml(text);
  const errors = [];
  for (const key of ["name", "description", "developer_instructions"]) {
    if (!fields[key]) errors.push(`missing required field: ${key}`);
  }
  if (fields.name && fields.name !== AGENT_NAME) {
    errors.push(`expected name = "${AGENT_NAME}", got "${fields.name}"`);
  }
  return {
    ok: errors.length === 0,
    file,
    hash: sha256Text(text),
    fields,
    errors
  };
}

export function inspectAgentFile(file, sourceFile = null) {
  if (!existsSync(file)) {
    return { exists: false, file };
  }
  const text = readFileSync(file, "utf8");
  const fields = parseAgentToml(text);
  const sourceText = sourceFile && existsSync(sourceFile) ? readFileSync(sourceFile, "utf8") : null;
  return {
    exists: true,
    file,
    hash: sha256Text(text),
    sourceHash: sourceText ? sha256Text(sourceText) : null,
    sameAsSource: sourceText ? text === sourceText : false,
    name: fields.name,
    declaresExpectedName: fields.name === AGENT_NAME
  };
}

export function backupPathFor(file, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${file}.bak.${stamp}`;
}

export function registerAgent({
  scope,
  sourceFile,
  projectRoot = process.cwd(),
  codexHome = defaultCodexHome(),
  force = false,
  backup = false
}) {
  if (!sourceFile) {
    throw new InstallerError("Cannot register swarm-expert without an installed plugin agent template.");
  }
  const source = validateAgentSource(sourceFile);
  if (!source.ok) {
    throw new InstallerError("Invalid swarm-expert template from installed plugin.", { source });
  }

  const target = targetAgentPath({ scope, projectRoot, codexHome });
  const sourceText = readFileSync(sourceFile, "utf8");
  const sourceHash = sha256Text(sourceText);

  if (existsSync(target)) {
    const currentText = readFileSync(target, "utf8");
    const currentHash = sha256Text(currentText);
    if (currentText === sourceText) {
      return { action: "already-installed", target, hash: sourceHash };
    }

    const currentName = parseAgentToml(currentText).name;
    if (!force && !backup) {
      throw new InstallerError("Refusing to overwrite existing custom agent file.", {
        target,
        existingHash: currentHash,
        newHash: sourceHash,
        existingName: currentName,
        existingDeclaresExpectedName: currentName === AGENT_NAME
      });
    }

    let backupFile = null;
    if (backup) {
      backupFile = backupPathFor(target);
      copyFileSync(target, backupFile);
    }
    writeFileSync(target, sourceText);
    return {
      action: backup ? "backed-up-and-overwritten" : "overwritten",
      target,
      backupFile,
      previousHash: currentHash,
      hash: sourceHash
    };
  }

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, sourceText);
  return { action: "created", target, hash: sourceHash };
}

export function uninstallAgent({
  scope,
  sourceFile = null,
  projectRoot = process.cwd(),
  codexHome = defaultCodexHome(),
  force = false,
  backup = false
}) {
  const target = targetAgentPath({ scope, projectRoot, codexHome });
  if (!existsSync(target)) {
    return { action: "already-absent", target };
  }

  const currentText = readFileSync(target, "utf8");
  const currentHash = sha256Text(currentText);
  const currentName = parseAgentToml(currentText).name;
  const sourceIsUsable = sourceFile && validateAgentSource(sourceFile).ok;
  const sourceText = sourceIsUsable ? readFileSync(sourceFile, "utf8") : null;
  const sourceHash = sourceText ? sha256Text(sourceText) : null;
  const matchesSource = sourceText ? currentText === sourceText : false;

  if (!matchesSource && !force) {
    throw new InstallerError("Refusing to remove custom agent file that does not match the installed plugin template.", {
      target,
      existingHash: currentHash,
      expectedHash: sourceHash,
      existingName: currentName,
      existingDeclaresExpectedName: currentName === AGENT_NAME,
      sourceFile: sourceFile || null,
      hint: "Use --force to remove anyway, or --backup --force to save a copy first."
    });
  }

  let backupFile = null;
  if (backup) {
    backupFile = backupPathFor(target);
    copyFileSync(target, backupFile);
  }
  unlinkSync(target);
  return {
    action: matchesSource ? "removed" : "force-removed",
    target,
    backupFile,
    previousHash: currentHash,
    expectedHash: sourceHash
  };
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeoutMs || 120_000
  });
  return {
    command,
    args,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
    ok: result.status === 0 && !result.error
  };
}

export function commandOutput(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}

export function findExecutable(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

export function parsePluginList(output) {
  const line = output.split(/\r?\n/).find((entry) => entry.includes(PLUGIN_ID));
  if (!line) {
    return { found: false };
  }
  const columns = line.trim().split(/\s{2,}/);
  const version = line.match(/\b\d+\.\d+\.\d+\b/)?.[0] || null;
  return {
    found: true,
    line,
    installed: /\binstalled\b/.test(line),
    enabled: /\benabled\b/.test(line),
    version,
    path: columns.at(-1) || null
  };
}

export function getPluginStatus({ codexBin = "codex", cwd = process.cwd() } = {}) {
  const result = runCommand(codexBin, ["plugin", "list"], { cwd });
  if (!result.ok) {
    return { ok: false, result, status: { found: false } };
  }
  return { ok: true, result, status: parsePluginList(result.stdout) };
}

export function resolveInstalledPluginAgentSource({ codexBin = "codex", cwd = process.cwd() } = {}) {
  const plugin = getPluginStatus({ codexBin, cwd });
  if (!plugin.ok) {
    throw new InstallerError("Could not inspect Codex plugins.", { result: plugin.result });
  }
  if (!plugin.status.found) {
    throw new InstallerError(`Plugin ${PLUGIN_ID} is not installed.`);
  }
  if (!plugin.status.installed || !plugin.status.enabled) {
    throw new InstallerError(`Plugin ${PLUGIN_ID} is not installed and enabled.`, { line: plugin.status.line });
  }
  if (!plugin.status.path) {
    throw new InstallerError(`Plugin ${PLUGIN_ID} path could not be parsed from codex plugin list.`, {
      line: plugin.status.line
    });
  }
  const sourceFile = pluginAgentPath(plugin.status.path);
  const source = validateAgentSource(sourceFile);
  if (!source.ok) {
    throw new InstallerError("Installed swarm-discussion plugin does not provide a valid swarm-expert template.", {
      pluginRoot: plugin.status.path,
      source
    });
  }
  return {
    sourceFile,
    pluginRoot: plugin.status.path,
    plugin: plugin.status,
    source
  };
}

export function parseRuntimeDoctorOutput(output) {
  try {
    const payload = JSON.parse(output);
    const ok = payload?.ok === true;
    const compatibility = payload?.wrapper?.compatibility || payload?.contractSummary?.compatibility || null;
    const source = payload?.runtime?.source || null;
    const fixtureSmokeOk = payload?.fixtureSmoke ? payload.fixtureSmoke.ok === true : null;
    return {
      ok,
      payload,
      compatibility,
      source,
      fixtureSmokeOk,
      compatible: ok && compatibility === RUNTIME_COMPATIBILITY
    };
  } catch (error) {
    return {
      ok: false,
      payload: null,
      compatibility: null,
      source: null,
      fixtureSmokeOk: null,
      compatible: false,
      error: error.message
    };
  }
}

export function runBundledRuntimeDoctor({
  pluginRoot,
  pythonBin = "python3",
  runner = runCommand
} = {}) {
  const wrapper = pluginRuntimeWrapperPath(pluginRoot);
  if (!wrapper || !existsSync(wrapper)) {
    return {
      ok: false,
      wrapper,
      detail: wrapper ? `missing wrapper: ${wrapper}` : "plugin root unavailable",
      result: null,
      parsed: null
    };
  }

  const env = { ...process.env };
  delete env[RUNTIME_OVERRIDE_ENV];
  const result = runner(pythonBin, [wrapper, "doctor", "--smoke-fixture"], { cwd: pluginRoot, env });
  const parsed = parseRuntimeDoctorOutput(result.stdout || "");
  const ok = result.ok && parsed.compatible && parsed.source === "bundled" && parsed.fixtureSmokeOk === true;
  let detail = "";
  if (ok) {
    const summary = parsed.payload.contractSummary || {};
    const smoke = parsed.payload.fixtureSmoke?.summary || {};
    detail = `bundled ${parsed.compatibility}; ${summary.commandCount || 0} commands; fixture ${smoke.health || "unknown"}; ${wrapper}`;
  } else if (
    parsed.compatibility === RUNTIME_COMPATIBILITY &&
    parsed.source === "bundled" &&
    parsed.fixtureSmokeOk === false
  ) {
    detail = "bundled runtime fixture smoke failed";
  } else if (!result.ok) {
    detail = commandOutput(result).trim() || `python command failed: ${pythonBin} ${wrapper} doctor`;
  } else if (!parsed.ok) {
    detail = parsed.error ? `invalid runtime doctor JSON: ${parsed.error}` : "runtime doctor reported failure";
  } else if (parsed.compatibility !== RUNTIME_COMPATIBILITY) {
    detail = `expected ${RUNTIME_COMPATIBILITY}, got ${parsed.compatibility || "unknown"}`;
  } else {
    detail = `expected bundled runtime source, got ${parsed.source || "unknown"}`;
  }
  return { ok, wrapper, detail, result, parsed };
}

function looksAlreadyPresent(result) {
  return /already|exists|installed|duplicate/i.test(commandOutput(result));
}

function looksAlreadyAbsent(result) {
  return /not configured|not installed|not found|does not exist|unknown|absent/i.test(commandOutput(result));
}

export function installCodexPlugin({ codexBin = "codex", cwd = process.cwd() } = {}) {
  const commands = [
    ["plugin", "marketplace", "add", MARKETPLACE_REPO],
    ["plugin", "add", PLUGIN_ID]
  ];
  const results = [];
  for (const args of commands) {
    const result = runCommand(codexBin, args, { cwd });
    const idempotent = !result.ok && looksAlreadyPresent(result);
    results.push({ args, result, idempotent });
    if (!result.ok && !idempotent) {
      throw new InstallerError(`Codex command failed: codex ${args.join(" ")}`, { result });
    }
  }
  return results;
}

export function removeCodexPluginAndMarketplace({
  codexBin = "codex",
  cwd = process.cwd(),
  runner = runCommand
} = {}) {
  const commands = [
    ["plugin", "remove", PLUGIN_ID],
    ["plugin", "marketplace", "remove", MARKETPLACE_NAME]
  ];
  const results = [];
  for (const args of commands) {
    const result = runner(codexBin, args, { cwd });
    const idempotent = !result.ok && looksAlreadyAbsent(result);
    results.push({ args, result, idempotent });
    if (!result.ok && !idempotent) {
      throw new InstallerError(`Codex command failed: codex ${args.join(" ")}`, { result });
    }
  }
  return results;
}

export function runSpawnVerification({ codexBin = "codex", cwd = process.cwd() } = {}) {
  const prompt = 'Spawn exactly one subagent using agent_type "swarm-expert" and return whether it succeeded.';
  return runCommand(
    codexBin,
    [
      "exec",
      "-C",
      cwd,
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--disable",
      "multi_agent_v2",
      prompt
    ],
    { cwd, timeoutMs: 300_000 }
  );
}

export function createCheck(status, label, detail = "") {
  return { status, label, detail };
}

export function runDoctor({
  cwd = process.cwd(),
  codexHome = defaultCodexHome(),
  projectRoot = cwd,
  codexBin = "codex",
  verifySpawn = false
} = {}) {
  const checks = [];
  let sourceFile = null;
  let sourceOk = false;
  let pluginRoot = null;

  const codexPath = findExecutable(codexBin);
  checks.push(
    codexPath
      ? createCheck(OK, "codex CLI found", codexPath)
      : createCheck(FAIL, "codex CLI not found", "Install Codex CLI or put it on PATH.")
  );

  if (codexPath) {
    const version = runCommand(codexBin, ["--version"], { cwd });
    checks.push(
      version.ok
        ? createCheck(OK, "codex CLI version", version.stdout.trim() || version.stderr.trim())
        : createCheck(WARN, "codex CLI version unavailable", commandOutput(version).trim())
    );

    const plugin = getPluginStatus({ codexBin, cwd });
    if (!plugin.ok) {
      checks.push(createCheck(FAIL, "codex plugin list failed", commandOutput(plugin.result).trim()));
    } else if (!plugin.status.found) {
      checks.push(createCheck(FAIL, "swarm-discussion plugin not installed", `Expected ${PLUGIN_ID}.`));
    } else if (!plugin.status.installed || !plugin.status.enabled) {
      checks.push(createCheck(FAIL, "swarm-discussion plugin not installed and enabled", plugin.status.line));
    } else {
      checks.push(
        createCheck(
          OK,
          "swarm-discussion plugin installed and enabled",
          plugin.status.version ? `version ${plugin.status.version}` : plugin.status.line
        )
      );
      sourceFile = pluginAgentPath(plugin.status.path);
      pluginRoot = plugin.status.path;
      const source = validateAgentSource(sourceFile);
      sourceOk = source.ok;
      checks.push(
        source.ok
          ? createCheck(OK, "plugin swarm-expert template is valid", sourceFile)
          : createCheck(FAIL, "plugin swarm-expert template is invalid", source.errors.join("; "))
      );
      const runtime = runBundledRuntimeDoctor({ pluginRoot });
      checks.push(
        runtime.ok
          ? createCheck(OK, "plugin bundled runtime is valid", runtime.detail)
          : createCheck(FAIL, "plugin bundled runtime is invalid", runtime.detail)
      );
    }
  }

  const globalPath = targetAgentPath({ scope: "global", codexHome, projectRoot });
  const projectPath = targetAgentPath({ scope: "project", codexHome, projectRoot });
  const globalAgent = inspectAgentFile(globalPath, sourceOk ? sourceFile : null);
  const projectAgent = inspectAgentFile(projectPath, sourceOk ? sourceFile : null);

  addAgentCheck(checks, "global", globalAgent);
  addAgentCheck(checks, "project", projectAgent);

  if (sourceOk && projectAgent.exists && projectAgent.sameAsSource && projectAgent.declaresExpectedName) {
    checks.push(createCheck(OK, "effective custom agent", `project agent: ${projectPath}`));
  } else if (sourceOk && globalAgent.exists && globalAgent.sameAsSource && globalAgent.declaresExpectedName) {
    checks.push(createCheck(OK, "effective custom agent", `global agent: ${globalPath}`));
  } else {
    checks.push(createCheck(FAIL, "effective custom agent missing", "Run install --global or install --project."));
  }

  if (verifySpawn) {
    if (!codexPath) {
      checks.push(createCheck(SKIPPED, "spawn smoke test", "codex CLI not found"));
    } else {
      const spawn = runSpawnVerification({ codexBin, cwd });
      checks.push(
        spawn.ok
          ? createCheck(OK, "spawn smoke test command exited 0", (spawn.stdout || spawn.stderr).trim())
          : createCheck(FAIL, "spawn smoke test failed", commandOutput(spawn).trim())
      );
    }
  } else {
    checks.push(createCheck(SKIPPED, "spawn smoke test", "pass --verify-spawn to run it"));
  }

  return {
    ok: !checks.some((check) => check.status === FAIL),
    checks
  };
}

function addAgentCheck(checks, scope, agent) {
  if (!agent.exists) {
    checks.push(createCheck(WARN, `${scope} custom agent missing`, agent.file));
    return;
  }
  if (!agent.declaresExpectedName) {
    checks.push(createCheck(FAIL, `${scope} custom agent has wrong name`, `${agent.file} declares ${agent.name}`));
    return;
  }
  if (!agent.sameAsSource) {
    checks.push(
      createCheck(
        FAIL,
        `${scope} custom agent differs from plugin template`,
        `${agent.file} existing=${agent.hash} expected=${agent.sourceHash}`
      )
    );
    return;
  }
  checks.push(createCheck(OK, `${scope} custom agent installed`, agent.file));
}

export function formatChecks(checks) {
  return checks
    .map((check) => `${check.status.padEnd(7)} ${check.label}${check.detail ? ` - ${check.detail}` : ""}`)
    .join("\n");
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const scopes = [];
  const options = {
    command,
    scope: null,
    force: false,
    backup: false,
    all: false,
    verifySpawn: false,
    help: false,
    version: false
  };

  if (!command || command === "--help" || command === "-h") {
    options.help = true;
    options.command = command || "help";
    return options;
  }
  if (command === "--version" || command === "-v") {
    options.version = true;
    return options;
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--global") {
      options.scope = "global";
      scopes.push(arg);
    } else if (arg === "--project") {
      options.scope = "project";
      scopes.push(arg);
    }
    else if (arg === "--force") options.force = true;
    else if (arg === "--backup") options.backup = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--verify-spawn") options.verifySpawn = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new InstallerError(`Unknown argument: ${arg}`);
  }

  if (scopes.length > 1) {
    throw new InstallerError(`Choose exactly one install scope, got: ${scopes.join(", ")}`);
  }
  if (command === "uninstall" && options.verifySpawn) {
    throw new InstallerError("uninstall does not support --verify-spawn");
  }
  if (options.all && command !== "uninstall") {
    throw new InstallerError("--all is only supported by uninstall");
  }
  if (command === "uninstall" && options.all && options.backup) {
    throw new InstallerError("uninstall --all does not support --backup");
  }

  return options;
}

export function usage() {
  return `Usage:
  swarm-discussion-installer install --global [--backup|--force] [--verify-spawn]
  swarm-discussion-installer install --project [--backup|--force] [--verify-spawn]
  swarm-discussion-installer repair --global [--backup|--force] [--verify-spawn]
  swarm-discussion-installer repair --project [--backup|--force] [--verify-spawn]
  swarm-discussion-installer uninstall --global [--backup] [--force]
  swarm-discussion-installer uninstall --project [--backup] [--force]
  swarm-discussion-installer uninstall --global --all
  swarm-discussion-installer uninstall --project --all
  swarm-discussion-installer doctor [--verify-spawn]

Commands:
  install   Install/update the Codex plugin and register swarm-expert.toml.
  repair    Reinstall/update the Codex plugin, then repair swarm-expert.toml registration.
  uninstall Remove swarm-expert.toml registration only; pass --all for plugin and marketplace removal.
  doctor    Diagnose plugin and custom-agent registration without modifying files.

Options:
  --global        Register ~/.codex/agents/swarm-expert.toml.
  --project       Register ./.codex/agents/swarm-expert.toml in the current directory.
  --backup        Back up an existing different target before overwriting it.
  --force         Overwrite an existing different target without making a backup.
  --all           Clean uninstall: no backup; remove agent registration, Codex plugin, and marketplace.
  --verify-spawn  Run an optional Codex exec smoke test that attempts a real swarm-expert spawn.
`;
}

export function readPackageVersion(root = packageRoot()) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.version;
}

export function main(argv = process.argv.slice(2), io = process) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      io.stdout.write(usage());
      return 0;
    }
    if (options.version) {
      io.stdout.write(`${readPackageVersion()}\n`);
      return 0;
    }

    if (options.command === "doctor") {
      const doctor = runDoctor({ verifySpawn: options.verifySpawn });
      io.stdout.write(`${formatChecks(doctor.checks)}\n`);
      return doctor.ok ? 0 : 1;
    }

    if (options.command === "install" || options.command === "repair") {
      if (!options.scope) {
        throw new InstallerError(`${options.command} requires exactly one of --global or --project`);
      }

      const codexPath = findExecutable("codex");
      if (!codexPath) {
        throw new InstallerError("codex CLI not found. Install Codex CLI or put it on PATH.");
      }

      io.stdout.write(`${options.command === "repair" ? "Repairing" : "Installing"} Codex plugin from ${MARKETPLACE_REPO}...\n`);
      const pluginResults = installCodexPlugin();
      for (const step of pluginResults) {
        const rendered = `codex ${step.args.join(" ")}`;
        io.stdout.write(`${step.result.ok ? OK : WARN} ${rendered}\n`);
      }

      const source = resolveInstalledPluginAgentSource();
      io.stdout.write(`${OK} plugin agent template: ${source.sourceFile}\n`);
      const target = targetAgentPath({ scope: options.scope });
      io.stdout.write(`Registering ${AGENT_NAME} at ${target}\n`);
      const registration = registerAgent({
        scope: options.scope,
        sourceFile: source.sourceFile,
        force: options.force,
        backup: options.backup
      });
      io.stdout.write(`${OK} custom agent ${registration.action}: ${registration.target}\n`);
      if (registration.backupFile) {
        io.stdout.write(`${OK} backup created: ${registration.backupFile}\n`);
      }

      const doctor = runDoctor({ verifySpawn: options.verifySpawn });
      io.stdout.write(`${formatChecks(doctor.checks)}\n`);
      return doctor.ok ? 0 : 1;
    }

    if (options.command === "uninstall") {
      if (!options.scope) {
        throw new InstallerError("uninstall requires exactly one of --global or --project");
      }

      if (options.all) {
        const codexPath = findExecutable("codex");
        if (!codexPath) {
          throw new InstallerError("codex CLI not found. Cannot remove Codex plugin or marketplace.");
        }

        const result = uninstallAgent({
          scope: options.scope,
          force: true,
          backup: false
        });
        io.stdout.write(`${OK} custom agent ${result.action}: ${result.target}\n`);
        io.stdout.write(`Removing Codex plugin and marketplace...\n`);
        const removalResults = removeCodexPluginAndMarketplace();
        for (const step of removalResults) {
          const rendered = `codex ${step.args.join(" ")}`;
          io.stdout.write(`${step.result.ok ? OK : SKIPPED} ${rendered}${step.idempotent ? " (already absent)" : ""}\n`);
        }
        return 0;
      }

      let sourceFile = null;
      const codexPath = findExecutable("codex");
      if (codexPath) {
        try {
          sourceFile = resolveInstalledPluginAgentSource().sourceFile;
          io.stdout.write(`${OK} plugin agent template: ${sourceFile}\n`);
        } catch (error) {
          if (!options.force) {
            throw error;
          }
          io.stdout.write(`${WARN} could not resolve plugin agent template; continuing because --force was provided\n`);
        }
      } else if (!options.force) {
        throw new InstallerError("codex CLI not found. Cannot safely compare the target against the installed plugin template.");
      } else {
        io.stdout.write(`${WARN} codex CLI not found; continuing because --force was provided\n`);
      }

      const result = uninstallAgent({
        scope: options.scope,
        sourceFile,
        force: options.force,
        backup: options.backup
      });
      io.stdout.write(`${OK} custom agent ${result.action}: ${result.target}\n`);
      if (result.backupFile) {
        io.stdout.write(`${OK} backup created: ${result.backupFile}\n`);
      }
      io.stdout.write(`${SKIPPED} Codex plugin uninstall - this command only removes custom-agent registration\n`);
      return 0;
    }

    throw new InstallerError(`Unknown command: ${options.command}`);
  } catch (error) {
    if (error instanceof InstallerError) {
      io.stderr.write(`FAIL ${error.message}\n`);
      if (error.details && Object.keys(error.details).length > 0) {
        io.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
      }
      return 1;
    }
    io.stderr.write(`FAIL ${error.stack || error.message}\n`);
    return 1;
  }
}
