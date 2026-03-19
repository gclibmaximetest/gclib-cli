/** Registry platform. */
export type RegistryPlatform = 'githubcopilot' | 'claudecode'

/** GitHub Copilot item types. */
export type GithubCopilotItemType = 'agent' | 'skill' | 'instruction' | 'prompt' | 'hook'

/** Claude Code item types. */
export type ClaudeCodeItemType = 'agent' | 'skill' | 'command' | 'memory'

/** All registry item types across both platforms. */
export type RegistryItemType = GithubCopilotItemType | ClaudeCodeItemType

/** Per-item manifest in the registry. */
export interface Manifest {
  name: string
  type: RegistryItemType
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
  type: RegistryItemType
  description: string
  tags: string[]
  version: string
  authors: string[]
  path: string
}

/** index.json root shape: separate arrays per platform. */
export interface RegistryIndex {
  version: string
  updatedAt: string
  githubcopilot: RawIndexItem[]
  claudecode: RawIndexItem[]
}

/** Normalised item with platform injected — used everywhere in the CLI after fetching. */
export interface IndexItem extends RawIndexItem {
  platform: RegistryPlatform
}

/** Locked item in gclib.lock.json. */
export interface LockfileItem {
  name: string
  type: RegistryItemType
  version: string
  installedAt: string
}

/** gclib.lock.json in the consuming project. */
export interface Lockfile {
  version: string
  items: LockfileItem[]
}
