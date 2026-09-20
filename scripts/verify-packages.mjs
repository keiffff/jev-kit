import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const packagesRoot = join(root, "packages");
const temporary = await mkdtemp(join(tmpdir(), "jev-kit-pack-"));
const tarballDirectory = join(temporary, "tarballs");
const smokeDirectory = join(temporary, "smoke");

try {
  await mkdir(tarballDirectory);
  const packageDirectories = (await readdir(packagesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name))
    .sort();
  const tarballs = [];

  for (const packageDirectory of packageDirectories) {
    const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
    const before = new Set(await readdir(tarballDirectory));
    run("pnpm", ["--dir", packageDirectory, "pack", "--pack-destination", tarballDirectory], root);
    const created = (await readdir(tarballDirectory)).filter((file) => !before.has(file) && file.endsWith(".tgz"));
    if (created.length !== 1) fail(`${manifest.name}: expected one tarball, found ${created.length}`);
    const tarball = join(tarballDirectory, created[0]);
    tarballs.push(tarball);

    const entries = run("tar", ["-tzf", tarball], root).stdout.trim().split("\n");
    requireEntry(entries, "package/package.json", manifest.name);
    requireEntry(entries, "package/README.md", manifest.name);
    requireEntry(entries, "package/LICENSE", manifest.name);
    requireEntry(entries, "package/dist/index.js", manifest.name);
    requireEntry(entries, "package/dist/index.d.ts", manifest.name);
    if (manifest.name === "@jev-kit/cli") requireEntry(entries, "package/dist/cli.js", manifest.name);
    if (manifest.name === "@jev-kit/agent-review") {
      requireEntry(entries, "package/schemas/review-request.schema.json", manifest.name);
      requireEntry(entries, "package/schemas/review-result.schema.json", manifest.name);
    }

    const packedManifest = JSON.parse(run("tar", ["-xOzf", tarball, "package/package.json"], root).stdout);
    if (JSON.stringify(packedManifest).includes("workspace:")) {
      fail(`${manifest.name}: packed manifest still contains a workspace protocol`);
    }
  }

  await mkdir(smokeDirectory);
  await writeFile(join(smokeDirectory, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], smokeDirectory, {
    npm_config_cache: join(temporary, "npm-cache"),
  });

  const imports = [
    "@jev-kit/agent-review",
    "@jev-kit/cli",
    "@jev-kit/decision-contract",
    "@jev-kit/decision-eval",
    "@jev-kit/decision-router",
    "@jev-kit/evidence-check",
    "@jev-kit/hook-adapters",
    "@jev-kit/semantic-diff",
  ];
  run("node", ["--input-type=module", "--eval", `await Promise.all(${JSON.stringify(imports)}.map((name) => import(name)))`], smokeDirectory);

  const cli = join(smokeDirectory, "node_modules", ".bin", "jev-agent-review");
  const cliResult = spawnSync(cli, [], { cwd: smokeDirectory, encoding: "utf8" });
  if (cliResult.status !== 2 || !cliResult.stderr.includes("--adapter is required")) {
    fail(`CLI smoke test failed: ${cliResult.stderr || cliResult.stdout}`);
  }

  process.stdout.write(`verified ${tarballs.length} package tarballs\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function requireEntry(entries, expected, packageName) {
  if (!entries.includes(expected)) fail(`${packageName}: missing ${expected}`);
}

function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) fail(`${command} ${args.map(quote).join(" ")} failed\n${result.stderr || result.stdout}`);
  return result;
}

function quote(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function fail(message) {
  throw new Error(message);
}
