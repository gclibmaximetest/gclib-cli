import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Manifest } from '../types.js'

export type ConflictMode = 'overwrite' | 'skip' | 'merge'

const MERGE_SEPARATOR = '\n\n<!-- gclib merge -->\n\n'

export interface InstallOptions {
  cwd: string
  conflictMode?: ConflictMode
  onConflict?: (
    filePath: string
  ) => Promise<'overwrite' | 'skip' | 'merge'>
}

/**
 * Normalize legacy install targets:
 * - .github/copilot/… → .github/… (old Copilot path format)
 */
function normalizeTarget(target: string): string {
  const legacyPrefix = '.github/copilot/'
  if (target === legacyPrefix || target.startsWith(legacyPrefix)) {
    return `.github/${target.slice(legacyPrefix.length)}`
  }
  return target
}

/**
 * Skills install under `<target>/<name>/`. Some manifests already put `name` in `target`
 * (e.g. `.claude/skills/my-skill`), which would yield `.../my-skill/my-skill/` — drop that
 * duplicate trailing segment when it matches `manifest.name`.
 */
function skillInstallBaseTarget(normalizedTarget: string, skillName: string): string {
  const trimmed = normalizedTarget.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return normalizedTarget
  if (parts[parts.length - 1] !== skillName) return normalizedTarget
  const parent = parts.slice(0, -1).join('/')
  return `${parent}/`
}

export async function installItem(
  cwd: string,
  manifest: Manifest,
  fileContents: Map<string, string>,
  options: InstallOptions
): Promise<{ written: string[]; skipped: string[] }> {
  let baseTarget = normalizeTarget(manifest.target)
  if (manifest.type === 'skill') {
    baseTarget = skillInstallBaseTarget(baseTarget, manifest.name)
  }
  // Skills live in a named subfolder: <target>/<name>/SKILL.md
  const targetDir =
    manifest.type === 'skill'
      ? join(cwd, baseTarget, manifest.name)
      : join(cwd, baseTarget)
  const written: string[] = []
  const skipped: string[] = []

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  for (const file of manifest.files) {
    const content = fileContents.get(file)
    if (content === undefined) continue

    const filePath = join(targetDir, file)
    const exists = existsSync(filePath)

    let action: ConflictMode = options.conflictMode ?? 'overwrite'
    if (exists && !options.conflictMode && options.onConflict) {
      action = await options.onConflict(filePath)
    } else if (exists && options.conflictMode === 'skip') {
      action = 'skip'
    } else if (exists && options.conflictMode === 'overwrite') {
      action = 'overwrite'
    }

    if (exists && action === 'skip') {
      skipped.push(filePath)
      continue
    }

    if (exists && action === 'merge') {
      const existing = readFileSync(filePath, 'utf-8')
      const merged = existing + MERGE_SEPARATOR + content
      writeFileSync(filePath, merged, 'utf-8')
      written.push(filePath)
      continue
    }

    writeFileSync(filePath, content, 'utf-8')
    written.push(filePath)
  }

  return { written, skipped }
}
