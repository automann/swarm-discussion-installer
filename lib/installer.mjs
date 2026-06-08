import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@automann/swarm-discussion-installer";
export const MARKETPLACE_REPO = "automann/swarm-discussion";
export const PLUGIN_ID = "swarm-discussion@swarm-discussion";
export const AGENT_NAME = "swarm-expert";

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

export function sourceAgentPath(root = packageRoot()) {
  return path.join(root, "installer", "fixtures", "swarm-expert.toml");
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

export function validateAgentTemplate(file = sourceAgentPath()) {
  if (!existsSync(file)) {
    return { ok: false, file, errors: [`template not found: ${file}`] };
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

export function inspectAgentFile(file, sourceFile = sourceAgentPath()) {
  if (!existsSync(file)) {
    return { exists: false, file };
  }
  const text = readFileSync(file, "utf8");
  const sourceText = readFileSync(sourceFile, "utf8");
  const fields = parseAgentToml(text);
  return {
    exists: true,
    file,
    hash: sha256Text(text),
    sourceHash: sha256Text(sourceText),
    sameAsSource: text === sourceText,
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
  sourceFile = sourceAgentPath(),
  projectRoot = process.cwd(),
  codexHome = defaultCodexHome(),
  force = false,
  backup = false
}) {
  const template = validateAgentTemplate(sourceFile);
  if (!template.ok) {
    throw new InstallerError("Invalid bundled swarm-expert template.", { template });
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

function looksAlreadyPresent(result) {
  return /already|exists|installed|duplicate/i.test(commandOutput(result));
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
  sourceFile = sourceAgentPath(),
  verifySpawn = false
} = {}) {
  const checks = [];
  const template = validateAgentTemplate(sourceFile);
  checks.push(
    template.ok
      ? createCheck(OK, "bundled swarm-expert template is valid", sourceFile)
      : createCheck(FAIL, "bundled swarm-expert template is invalid", template.errors.join("; "))
  );

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
    }
  }

  const globalPath = targetAgentPath({ scope: "global", codexHome, projectRoot });
  const projectPath = targetAgentPath({ scope: "project", codexHome, projectRoot });
  const globalAgent = inspectAgentFile(globalPath, sourceFile);
  const projectAgent = inspectAgentFile(projectPath, sourceFile);

  addAgentCheck(checks, "global", globalAgent);
  addAgentCheck(checks, "project", projectAgent);

  if (projectAgent.exists && projectAgent.sameAsSource && projectAgent.declaresExpectedName) {
    checks.push(createCheck(OK, "effective custom agent", `project agent: ${projectPath}`));
  } else if (globalAgent.exists && globalAgent.sameAsSource && globalAgent.declaresExpectedName) {
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
        `${scope} custom agent differs from bundled template`,
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
    else if (arg === "--verify-spawn") options.verifySpawn = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new InstallerError(`Unknown argument: ${arg}`);
  }

  if (scopes.length > 1) {
    throw new InstallerError(`Choose exactly one install scope, got: ${scopes.join(", ")}`);
  }

  return options;
}

export function usage() {
  return `Usage:
  swarm-discussion-installer install --global [--backup|--force] [--verify-spawn]
  swarm-discussion-installer install --project [--backup|--force] [--verify-spawn]
  swarm-discussion-installer doctor [--verify-spawn]

Commands:
  install   Install/update the Codex plugin and register swarm-expert.toml.
  doctor    Diagnose plugin and custom-agent registration without modifying files.

Options:
  --global        Register ~/.codex/agents/swarm-expert.toml.
  --project       Register ./.codex/agents/swarm-expert.toml in the current directory.
  --backup        Back up an existing different target before overwriting it.
  --force         Overwrite an existing different target without making a backup.
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

    if (options.command === "install") {
      if (!options.scope) {
        throw new InstallerError("install requires exactly one of --global or --project");
      }

      const codexPath = findExecutable("codex");
      if (!codexPath) {
        throw new InstallerError("codex CLI not found. Install Codex CLI or put it on PATH.");
      }

      const template = validateAgentTemplate();
      if (!template.ok) {
        throw new InstallerError("Bundled swarm-expert template is invalid.", { errors: template.errors });
      }

      io.stdout.write(`Installing Codex plugin from ${MARKETPLACE_REPO}...\n`);
      const pluginResults = installCodexPlugin();
      for (const step of pluginResults) {
        const rendered = `codex ${step.args.join(" ")}`;
        io.stdout.write(`${step.result.ok ? OK : WARN} ${rendered}\n`);
      }

      const target = targetAgentPath({ scope: options.scope });
      io.stdout.write(`Registering ${AGENT_NAME} at ${target}\n`);
      const registration = registerAgent({
        scope: options.scope,
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
