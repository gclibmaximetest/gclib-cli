import { join } from "node:path";
import chalk from "chalk";

// Rely on CJS bundle providing __dirname and require (tsup injects these)
declare const __dirname: string;
declare const require: NodeRequire;

/** Default branch to read package.json from on GitHub */
const DEFAULT_BRANCH = "main";

/** Timeout for the GitHub fetch so we don't block the CLI */
const FETCH_TIMEOUT_MS = 4000;

export interface VersionCheckResult {
  local: string;
  remote: string | null;
  match: boolean;
  error?: string;
}

function getLocalPackageJson(): { version: string; repository?: string | { url?: string } } {
  // When built, we're in dist/, so package.json is one level up
  const pkgPath = join(__dirname, "..", "package.json");
  return require(pkgPath);
}

/** Get the current CLI version from package.json (for program.version()). */
export function getLocalVersion(): string {
  return getLocalPackageJson().version ?? "0.0.0";
}

function parseGitHubRepo(pkg: { repository?: string | { url?: string } }): { owner: string; repo: string } | null {
  const repo = pkg.repository;
  if (!repo) return null;
  const url = typeof repo === "string" ? repo : repo.url;
  if (!url) return null;
  // "github:owner/repo" or "https://github.com/owner/repo" or "https://github.com/owner/repo.git"
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i) ?? url.match(/^github:([^/]+)\/([^/]+)$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function getRawPackageJsonUrl(owner: string, repo: string, branch: string = DEFAULT_BRANCH): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/package.json`;
}

export async function checkVersion(): Promise<VersionCheckResult> {
  const pkg = getLocalPackageJson();
  const local = pkg.version ?? "0.0.0";

  const repo = parseGitHubRepo(pkg);
  if (!repo) {
    return { local, remote: null, match: true, error: "No GitHub repository in package.json" };
  }

  const url = getRawPackageJsonUrl(repo.owner, repo.repo);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return { local, remote: null, match: true, error: `GitHub returned ${res.status}` };
    }
    const remotePkg = (await res.json()) as { version?: string };
    const remote = remotePkg.version ?? null;
    if (remote === null) {
      return { local, remote: null, match: true };
    }
    return {
      local,
      remote,
      match: local === remote,
    };
  } catch (e) {
    clearTimeout(timeout);
    const message = e instanceof Error ? e.message : String(e);
    return { local, remote: null, match: true, error: message };
  }
}

export function warnIfVersionMismatch(result: VersionCheckResult): void {
  if (result.match || result.remote === null) return;
  console.warn(
    chalk.yellow(
      `\n⚠ Version mismatch: you have ${result.local}, GitHub has ${result.remote}. Consider updating (e.g. npm update -g gclib).\n`
    )
  );
}

/**
 * Run version check and optionally warn. Safe to call before every command.
 * Skips if GCLIB_SKIP_VERSION_CHECK is set.
 */
export async function runVersionCheck(): Promise<void> {
  if (process.env.GCLIB_SKIP_VERSION_CHECK === "1" || process.env.GCLIB_SKIP_VERSION_CHECK === "true") {
    return;
  }
  const result = await checkVersion();
  warnIfVersionMismatch(result);
}
