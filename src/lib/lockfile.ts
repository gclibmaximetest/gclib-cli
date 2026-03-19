import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Lockfile, LockfileItem, RegistryPlatform } from '../types.js'

const LOCKFILE_NAME = 'gclib.lock.json'

export function getLockfilePath(cwd: string): string {
  return join(cwd, LOCKFILE_NAME)
}

export function readLockfile(cwd: string): Lockfile | null {
  const path = getLockfilePath(cwd)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw) as Lockfile
  } catch {
    return null
  }
}

export function writeLockfile(cwd: string, lockfile: Lockfile): void {
  const path = getLockfilePath(cwd)
  writeFileSync(path, JSON.stringify(lockfile, null, 2), 'utf-8')
}

export function upsertLockfileItem(
  cwd: string,
  item: LockfileItem
): Lockfile {
  const existing = readLockfile(cwd) ?? {
    version: '1',
    items: [],
  }
  const items = existing.items.filter(
    (i) => !(i.name === item.name && i.platform === item.platform)
  )
  items.push(item)
  const next: Lockfile = { ...existing, items }
  writeLockfile(cwd, next)
  return next
}

export function removeLockfileItem(cwd: string, name: string, platform: RegistryPlatform): Lockfile {
  const existing = readLockfile(cwd)
  if (!existing) {
    return { version: '1', items: [] }
  }
  const items = existing.items.filter((i) => !(i.name === name && i.platform === platform))
  const next: Lockfile = { ...existing, items }
  writeLockfile(cwd, next)
  return next
}
