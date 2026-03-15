import type { Command } from 'commander'
import { input, select } from '@inquirer/prompts'
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken } from '../lib/auth.js'
import { fetchIndex } from '../lib/registry.js'
import type { IndexItem, RegistryIndex, RegistryItemType } from '../types.js'

const REGISTRY_REPO = 'gclibmaximetest/gclib-registry'

/** All types matching .github folder structure: agents, skills, instructions, prompts, hooks. */
const TYPES: RegistryItemType[] = ['agent', 'skill', 'instruction', 'prompt', 'hook']

/** Per-type: .github folder name, default scaffold filename, target path in registry. */
const TYPE_CONFIG: Record<
  RegistryItemType,
  { folder: string; defaultFile: string; target: string }
> = {
  agent: { folder: 'agents', defaultFile: 'agent.md', target: '.github/agents/' },
  skill: { folder: 'skills', defaultFile: 'SKILL.md', target: '.github/skills/' },
  instruction: { folder: 'instructions', defaultFile: 'instructions.md', target: '.github/instructions/' },
  prompt: { folder: 'prompts', defaultFile: 'prompt.md', target: '.github/prompts/' },
  hook: { folder: 'hooks', defaultFile: 'hook.json', target: '.github/hooks/' },
}

const CREATE_NEW_VALUE = '__create_new__'

/** Derive registry item name from selected .github file path. */
function deriveNameFromPath(relativePath: string, type: RegistryItemType): string {
  const parts = relativePath.replace(/^\.github[/\\]/, '').split(/[/\\]/)
  if (type === 'skill') return parts[0] ?? 'my-skill'
  const base = parts[parts.length - 1] ?? ''
  if (type === 'hook') return base.replace(/\.json$/i, '') || 'my-hook'
  const suffix = type === 'agent' ? '.agent.md' : type === 'prompt' ? '.prompt.md' : '.instructions.md'
  return base.replace(new RegExp(`${suffix.replace('.', '\\.')}$`, 'i'), '') || 'my-item'
}

/** Resolve unique name using registry index: name, or name-2, name-3, ... if taken. */
function resolveFinalName(existingNames: Set<string>, name: string): string {
  if (!existingNames.has(name)) return name
  let n = 2
  while (existingNames.has(`${name}-${n}`)) n += 1
  return `${name}-${n}`
}

/** List selectable files from .github/<folder> for the given type. Returns relative path and label. */
function listGitHubFiles(cwd: string, type: RegistryItemType): { value: string; name: string }[] {
  const { folder } = TYPE_CONFIG[type]
  const dir = join(cwd, '.github', folder)
  if (!existsSync(dir)) return []

  if (type === 'skill') {
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((d) => {
        const skillPath = join(dir, d.name, 'SKILL.md')
        return existsSync(skillPath)
          ? { value: join('.github', folder, d.name, 'SKILL.md'), name: `${d.name}/SKILL.md` }
          : null
      })
      .filter((x): x is { value: string; name: string } => x !== null)
  }

  const entries = readdirSync(dir, { withFileTypes: true })
  const suffix = type === 'hook' ? '.json' : type === 'agent' ? '.agent.md' : type === 'prompt' ? '.prompt.md' : '.instructions.md'
  return entries
    .filter((e) => e.isFile() && (type === 'hook' ? e.name.endsWith('.json') : e.name.endsWith(suffix)))
    .map((e) => ({ value: join('.github', folder, e.name), name: e.name }))
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish')
    .description('Scaffold a new item and open a PR to the registry')
    .option('--no-pr', 'Only scaffold locally; do not create a PR')
    .action(async (options: { pr?: boolean }) => {
      const createPr = options.pr !== false

      console.log(ui.title('gclib publish'))

      let name: string
      let type: RegistryItemType
      let description: string
      let tagsInput: string

      const cwd = process.cwd()
      let selectedFilePath: string | null = null
      let fileContent: string | null = null

      try {
        type = await select({
          message: 'Type',
          choices: TYPES.map((t) => ({ value: t, name: t })),
        }) as RegistryItemType

        const githubFiles = listGitHubFiles(cwd, type)
        const fileChoices = [
          ...githubFiles.map((f) => ({ value: f.value, name: f.name })),
          { value: CREATE_NEW_VALUE, name: 'Create new (no file from .github)' },
        ]
        const selected = await select({
          message: 'Source file from .github',
          choices: fileChoices,
        })

        if (selected !== CREATE_NEW_VALUE) {
          selectedFilePath = selected
          const absPath = join(cwd, selected)
          if (existsSync(absPath)) {
            fileContent = readFileSync(absPath, 'utf-8')
          }
        }

        name = await input({
          message: 'Item name (e.g. my-skill-name)',
          default: selectedFilePath ? deriveNameFromPath(selectedFilePath, type) : undefined,
          validate: (v) => {
            if (!/^[a-z0-9-]+$/.test(v)) return 'Use only lowercase letters, numbers, and hyphens.'
            return true
          },
        })
        description = await input({ message: 'Short description' })
        tagsInput = await input({
          message: 'Tags (comma-separated)',
          placeholder: 'e.g. typescript, linting',
        })
      } catch {
        console.log(ui.dim('Cancelled.'))
        process.exit(0)
      }

      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const { folder: typeFolder, defaultFile, target } = TYPE_CONFIG[type]

      let finalName: string
      let manifest: { name: string; type: RegistryItemType; description: string; tags: string[]; version: string; files: string[]; target: string }

      if (createPr) {
        checkPrerequisites()
        const token = getGithubToken()
        let index: RegistryIndex
        try {
          index = await fetchIndex(token)
        } catch (err) {
          console.error(ui.error('Failed to fetch registry index. Run `gh auth login` and ensure you have access to the registry.'))
          if (err instanceof Error) console.error(ui.dim(err.message))
          process.exit(1)
        }
        const existingNames = new Set(index.items.filter((i) => i.type === type).map((i) => i.name))
        finalName = resolveFinalName(existingNames, name)
        if (finalName !== name) {
          console.log(ui.note('Name taken', `Using ${ui.bold(finalName)} (${name} already exists).`))
        }
        manifest = {
          name: finalName,
          type,
          description: description || '',
          tags,
          version: '1.0.0',
          files: [defaultFile],
          target,
        }
      } else {
        finalName = name
        manifest = {
          name: finalName,
          type,
          description: description || '',
          tags,
          version: '1.0.0',
          files: [defaultFile],
          target,
        }
      }

      const bodyContent =
        fileContent ?? (type === 'hook' ? '{}\n' : `# ${finalName}\n\n${description || ''}\n`)

      if (!createPr) {
        const scaffoldDir = join(cwd, 'gclib-registry-scaffold', typeFolder, finalName)
        if (!existsSync(scaffoldDir)) {
          mkdirSync(scaffoldDir, { recursive: true })
        }
        writeFileSync(join(scaffoldDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
        writeFileSync(join(scaffoldDir, defaultFile), bodyContent, 'utf-8')
        console.log(ui.success(`Scaffolded at ${ui.path(scaffoldDir)}`))
        console.log(
          ui.note(
            'Open PR',
            'Next: clone gclib-registry, copy this folder in, push a branch, and run:\n  gh pr create --fill'
          )
        )
        console.log(ui.outro('Done.'))
        return
      }

      const tempDir = mkdtempSync(join(tmpdir(), 'gclib-registry-publish-'))
      try {
        console.log(ui.dim('Cloning registry...'))
        execSync(`gh repo clone ${REGISTRY_REPO} "${tempDir}"`, {
          stdio: 'pipe',
          encoding: 'utf-8',
        })
      } catch {
        console.error(ui.error('Failed to clone registry. Run `gh auth login` and ensure you have access to the repo.'))
        console.log(ui.dim(`Temp dir left at: ${tempDir}`))
        process.exit(1)
      }

      const itemDir = join(tempDir, typeFolder, finalName)
      mkdirSync(itemDir, { recursive: true })
      writeFileSync(join(itemDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
      writeFileSync(join(itemDir, defaultFile), bodyContent, 'utf-8')

      const indexPath = join(tempDir, 'index.json')
      if (!existsSync(indexPath)) {
        console.error(ui.error('Registry clone missing index.json.'))
        console.log(ui.dim(`Temp dir left at: ${tempDir}`))
        process.exit(1)
      }
      let indexData: RegistryIndex
      try {
        indexData = JSON.parse(readFileSync(indexPath, 'utf-8')) as RegistryIndex
      } catch {
        console.error(ui.error('Invalid index.json in registry.'))
        console.log(ui.dim(`Temp dir left at: ${tempDir}`))
        process.exit(1)
      }
      const newItem: IndexItem = {
        name: finalName,
        type,
        description: description || '',
        tags,
        version: '1.0.0',
        path: `${typeFolder}/${finalName}`,
      }
      indexData.items.push(newItem)
      writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')

      let branchName = `publish/${finalName}`
      try {
        execSync(`git checkout -b ${branchName}`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
        execSync(`git add "${typeFolder}/${finalName}" index.json`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
        execSync(`git commit -m "Add ${type}: ${finalName}"`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
        for (let suffix = 0; ; suffix++) {
          const nameToPush = suffix === 0 ? branchName : `publish/${finalName}-${suffix}`
          if (suffix > 0) {
            execSync(`git branch -m ${nameToPush}`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
          }
          try {
            execSync(`git push -u origin ${nameToPush}`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
            branchName = nameToPush
            break
          } catch {
            if (suffix > 10) {
              console.error(ui.error('Git push failed after multiple attempts.'))
              console.log(ui.dim(`Temp dir left at: ${tempDir}`))
              process.exit(1)
            }
          }
        }
      } catch (err) {
        console.error(ui.error('Git branch, commit, or push failed.'))
        if (err instanceof Error) console.error(ui.dim(err.message))
        console.log(ui.dim(`Temp dir left at: ${tempDir}`))
        process.exit(1)
      }

      const prBody = description ? `${description}\n` : ''
      const prBodyPath = join(tmpdir(), `gclib-pr-body-${Date.now()}.txt`)
      try {
        writeFileSync(prBodyPath, prBody, 'utf-8')
        execSync(
          `gh pr create --repo ${REGISTRY_REPO} --head ${branchName} --title "Add ${type}: ${finalName}" --body-file "${prBodyPath}"`,
          { stdio: 'inherit', encoding: 'utf-8' }
        )
      } catch {
        console.error(ui.error('Failed to create PR. You can open one manually from the pushed branch.'))
        console.log(ui.dim(`Temp dir left at: ${tempDir}`))
        process.exit(1)
      } finally {
        if (existsSync(prBodyPath)) rmSync(prBodyPath, { force: true })
      }

      rmSync(tempDir, { recursive: true, force: true })
      console.log(ui.success('PR created.'))
      console.log(ui.outro('Done.'))
    })
}
