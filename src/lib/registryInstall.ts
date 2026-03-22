import { fetchFile } from './registry.js'
import { installItem, type InstallOptions } from './installer.js'
import type { LockfilePlatform, Manifest } from '../types.js'

/**
 * Bundle manifests sometimes set `target` to e.g. `.github/skills/<bundle-name>/`.
 * The installer then adds `<manifest.name>/`, producing a double folder. When installing
 * from a collection, drop a trailing segment that matches the collection name.
 */
export function stripCollectionSegmentFromTarget(target: string, collectionName: string): string {
  const trimmed = target.trim().replace(/[/\\]+$/, '')
  if (!trimmed) return target
  const parts = trimmed.split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return target
  if (parts[parts.length - 1] !== collectionName) return target
  const parent = parts.slice(0, -1).join('/')
  return `${parent}/`
}

/** First path segment must be `githubcopilot` or `claudecode` (registry root layout). */
export function lockfilePlatformFromRegistryPath(registryPath: string): LockfilePlatform {
  const p = registryPath.split('/')[0]
  if (p !== 'githubcopilot' && p !== 'claudecode') {
    throw new Error(`Invalid registry path (expected platform prefix): ${registryPath}`)
  }
  return p
}

export interface InstallFromRegistryContext {
  /** When set (collection install), normalizes `manifest.target` if it ends with this name. */
  collectionName?: string
}

/** Fetch manifest + files from a registry path such as `githubcopilot/skills/my-skill` and install. */
export async function installFromRegistryPath(
  token: string,
  cwd: string,
  registryPath: string,
  options: InstallOptions,
  context?: InstallFromRegistryContext
): Promise<{
  written: string[]
  skipped: string[]
  name: string
  type: Manifest['type']
  platform: LockfilePlatform
  version: string
}> {
  const manifestPath = `${registryPath}/manifest.json`
  const manifestRaw = await fetchFile(token, manifestPath)
  let manifest = JSON.parse(manifestRaw) as Manifest
  if (context?.collectionName) {
    manifest = {
      ...manifest,
      target: stripCollectionSegmentFromTarget(manifest.target, context.collectionName),
    }
  }

  const fileContents = new Map<string, string>()
  for (const file of manifest.files) {
    const content = await fetchFile(token, `${registryPath}/${file}`)
    fileContents.set(file, content)
  }

  const { written, skipped } = await installItem(cwd, manifest, fileContents, options)
  return {
    written,
    skipped,
    name: manifest.name,
    type: manifest.type,
    platform: lockfilePlatformFromRegistryPath(registryPath),
    version: manifest.version,
  }
}
