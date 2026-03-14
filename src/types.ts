/** Registry item type. */
export type RegistryItemType = 'agent' | 'skill' | 'instruction'

/** Per-item manifest in the registry. */
export interface Manifest {
  name: string
  type: RegistryItemType
  description: string
  tags: string[]
  version: string
  files: string[]
  target: string
}

/** Entry in the registry root index.json. */
export interface IndexItem {
  name: string
  type: RegistryItemType
  description: string
  tags: string[]
  version: string
  path: string
}

/** Registry root index.json. */
export interface RegistryIndex {
  version: string
  updatedAt: string
  items: IndexItem[]
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
