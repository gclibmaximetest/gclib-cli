import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ClaudeCodeItemType, GithubCopilotItemType, RegistryItemType, RegistryPlatform } from '../types.js'

export const REGISTRY_REPO = 'gclibmaximetest/gclib-registry'

export const GITHUBCOPILOT_TYPES: GithubCopilotItemType[] = ['agent', 'skill', 'instruction', 'prompt', 'hook']
export const CLAUDECODE_TYPES: ClaudeCodeItemType[] = ['agent', 'skill', 'command', 'memory']

export interface TypeConfig {
  /** Subfolder under the platform root in the registry, and under the local source folder. */
  folder: string
  /** Default scaffold filename. */
  defaultFile: string
  /** Install target path in the consuming project. */
  target: string
  /** Local source folder to scan for existing files (relative to cwd). */
  localSourceDir: string
}

export const GITHUBCOPILOT_TYPE_CONFIG: Record<GithubCopilotItemType, TypeConfig> = {
  agent:       { folder: 'agents',       defaultFile: 'agent.md',                        target: '.github/agents/',       localSourceDir: '.github/agents' },
  skill:       { folder: 'skills',       defaultFile: 'SKILL.md',                        target: '.github/skills/',       localSourceDir: '.github/skills' },
  instruction: { folder: 'instructions', defaultFile: 'instruction.instructions.md',     target: '.github/instructions/', localSourceDir: '.github/instructions' },
  prompt:      { folder: 'prompts',      defaultFile: 'prompt.prompt.md',                target: '.github/prompts/',      localSourceDir: '.github/prompts' },
  hook:        { folder: 'hooks',        defaultFile: 'hook.json',                       target: '.github/hooks/',        localSourceDir: '.github/hooks' },
}

export const CLAUDECODE_TYPE_CONFIG: Record<ClaudeCodeItemType, TypeConfig> = {
  agent:   { folder: 'agents',   defaultFile: 'agent.md',   target: '.claude/agents/',   localSourceDir: '.claude/agents' },
  skill:   { folder: 'skills',   defaultFile: 'SKILL.md',   target: '.claude/skills/',   localSourceDir: '.claude/skills' },
  command: { folder: 'commands', defaultFile: 'command.md', target: '.claude/commands/', localSourceDir: '.claude/commands' },
  memory:  { folder: 'memory',   defaultFile: 'CLAUDE.md',  target: '.claude/',          localSourceDir: '.claude' },
}

export function getTypeConfig(platform: RegistryPlatform, type: RegistryItemType): TypeConfig {
  if (platform === 'githubcopilot') {
    return GITHUBCOPILOT_TYPE_CONFIG[type as GithubCopilotItemType]
  }
  return CLAUDECODE_TYPE_CONFIG[type as ClaudeCodeItemType]
}

/** Derive registry item name from a local source file path. */
export function deriveNameFromPath(relativePath: string, platform: RegistryPlatform, type: RegistryItemType): string {
  const parts = relativePath.split(/[/\\]/).filter(Boolean)
  if (type === 'skill') {
    const skillFolder = parts.find((_, i) => parts[i - 1] === 'skills')
    return skillFolder ?? 'my-skill'
  }
  if (type === 'memory') return 'project-memory'
  const base = parts[parts.length - 1] ?? ''
  if (type === 'hook') return base.replace(/\.json$/i, '') || 'my-hook'
  if (type === 'command') return base.replace(/\.md$/i, '') || 'my-command'
  if (platform === 'githubcopilot') {
    if (type === 'agent') return base.replace(/\.agent\.md$/i, '') || 'my-agent'
    if (type === 'prompt') return base.replace(/\.prompt\.md$/i, '') || 'my-prompt'
    if (type === 'instruction') return base.replace(/\.instructions\.md$/i, '') || 'my-instruction'
  }
  return base.replace(/\.md$/i, '') || 'my-item'
}

/** List selectable files from the local source directory for the given platform+type. */
export function listLocalFiles(cwd: string, platform: RegistryPlatform, type: RegistryItemType): { value: string; name: string }[] {
  const config = getTypeConfig(platform, type)
  const dir = join(cwd, config.localSourceDir)
  if (!existsSync(dir)) return []

  if (type === 'skill') {
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((d) => {
        const skillPath = join(dir, d.name, 'SKILL.md')
        return existsSync(skillPath)
          ? { value: join(config.localSourceDir, d.name, 'SKILL.md'), name: `${d.name}/SKILL.md` }
          : null
      })
      .filter((x): x is { value: string; name: string } => x !== null)
  }

  if (type === 'memory') {
    const claudeMd = join(dir, 'CLAUDE.md')
    return existsSync(claudeMd) ? [{ value: join(config.localSourceDir, 'CLAUDE.md'), name: 'CLAUDE.md' }] : []
  }

  const entries = readdirSync(dir, { withFileTypes: true })
  let fileSuffix: string
  if (type === 'hook') fileSuffix = '.json'
  else if (platform === 'githubcopilot' && type === 'agent') fileSuffix = '.agent.md'
  else if (platform === 'githubcopilot' && type === 'prompt') fileSuffix = '.prompt.md'
  else if (type === 'instruction') fileSuffix = '.instructions.md'
  else fileSuffix = '.md'

  return entries
    .filter((e) => e.isFile() && e.name.endsWith(fileSuffix))
    .map((e) => ({ value: join(config.localSourceDir, e.name), name: e.name }))
}

/** Read a local file's content, returning null if it doesn't exist. */
export function readLocalFile(cwd: string, relativePath: string): string | null {
  const absPath = join(cwd, relativePath)
  if (!existsSync(absPath)) return null
  return readFileSync(absPath, 'utf-8')
}

/** Returns true if `next` is strictly higher than `current` (x.x.x semver). */
export function isHigherVersion(current: string, next: string): boolean {
  const parse = (v: string): [number, number, number] => {
    const parts = v.split('.').map(Number)
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
  }
  const [cM, cm, cp] = parse(current)
  const [nM, nm, np] = parse(next)
  return nM > cM || (nM === cM && nm > cm) || (nM === cM && nm === cm && np > cp)
}

/** Returns true if the string matches x.x.x semver format (non-negative integers). */
export function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(v)
}
