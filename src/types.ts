/** Registry platform as listed in the index; `collection` is synthetic (bundles). */
export type RegistryPlatform = 'githubcopilot' | 'claudecode' | 'collection'

/** Platform for registry items that install to disk (excludes synthetic `collection` index rows). */
export type LockfilePlatform = Exclude<RegistryPlatform, 'collection'>

/** GitHub Copilot item types. */
export type GithubCopilotItemType = 'agent' | 'skill' | 'instruction' | 'prompt' | 'hook'

/** Claude Code item types. */
export type ClaudeCodeItemType = 'agent' | 'skill' | 'command' | 'memory'

/** All registry item types across both platforms plus index-only bundles. */
export type RegistryItemType = GithubCopilotItemType | ClaudeCodeItemType | 'collection'

/** Per-item manifest in the registry (not used for `collection` bundles). */
export interface Manifest {
  name: string
  type: GithubCopilotItemType | ClaudeCodeItemType
  description: string
  tags: string[]
  version: string
  files: string[]
  target: string
  authors: string[]
}

/** An item as it appears inside the platform arrays of index.json (no platform field). */
export interface RawIndexItem {
  name: string
  type: GithubCopilotItemType | ClaudeCodeItemType
  description: string
  tags: string[]
  version: string
  authors: string[]
  path: string
}

/** On-disk manifest for a collection folder (`collections/<name>/manifest.json`). */
export interface CollectionManifest {
  name: string
  type: 'collection'
  description: string
  tags: string[]
  version: string
  authors: string[]
  entries: string[]
}

/** A bundle listing multiple registry paths under `entries`. */
export interface CollectionRawItem extends CollectionManifest {
  path: string
}

/** index.json root shape: separate arrays per platform. */
export interface RegistryIndex {
  version: string
  updatedAt: string
  githubcopilot: RawIndexItem[]
  claudecode: RawIndexItem[]
  collections?: CollectionRawItem[]
}

/** Normalised item with platform injected — used everywhere in the CLI after fetching. */
export type IndexItem =
  | (RawIndexItem & { platform: LockfilePlatform })
  | (CollectionRawItem & { platform: 'collection' })

/** Locked item in gclib.lock.json (`platform`/`type` may be `collection` for bundles). */
export interface LockfileItem {
  name: string
  type: RegistryItemType
  platform: RegistryPlatform
  version: string
  installedAt: string
}

/** gclib.lock.json in the consuming project. */
export interface Lockfile {
  version: string
  items: LockfileItem[]
}
