import type { Command } from 'commander'
import { input, select } from '@inquirer/prompts'
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken, getGithubUsername } from '../lib/auth.js'
import { fetchIndex } from '../lib/registry.js'
import {
  REGISTRY_REPO,
  GITHUBCOPILOT_TYPES,
  CLAUDECODE_TYPES,
  getTypeConfig,
  deriveNameFromPath,
  listLocalFiles,
  readLocalFile,
} from '../lib/publishShared.js'
import type { RawIndexItem, RegistryIndex, RegistryItemType, RegistryPlatform } from '../types.js'

const CREATE_NEW_VALUE = '__create_new__'

/** Resolve unique name using registry index: name, or name-2, name-3, ... if taken. */
function resolveFinalName(existingNames: Set<string>, name: string): string {
  if (!existingNames.has(name)) return name
  let n = 2
  while (existingNames.has(`${name}-${n}`)) n += 1
  return `${name}-${n}`
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
      let platform: RegistryPlatform
      let type: RegistryItemType
      let description: string
      let tagsInput: string
      let authorsInput: string

      const cwd = process.cwd()
      let selectedFilePath: string | null = null
      let fileContent: string | null = null

      const currentUsername = getGithubUsername()

      try {
        platform = await select({
          message: 'Platform',
          choices: [
            { value: 'githubcopilot' as RegistryPlatform, name: 'GitHub Copilot' },
            { value: 'claudecode' as RegistryPlatform, name: 'Claude Code' },
          ],
        })

        const typeChoices =
          platform === 'githubcopilot'
            ? GITHUBCOPILOT_TYPES.map((t) => ({ value: t as RegistryItemType, name: t }))
            : CLAUDECODE_TYPES.map((t) => ({ value: t as RegistryItemType, name: t }))

        type = await select({
          message: 'Type',
          choices: typeChoices,
        })

        const localFiles = listLocalFiles(cwd, platform, type)
        const fileChoices = [
          ...localFiles.map((f) => ({ value: f.value, name: f.name })),
          { value: CREATE_NEW_VALUE, name: 'Create new (no existing local file)' },
        ]
        const selected = await select({
          message: 'Source file',
          choices: fileChoices,
        })

        if (selected !== CREATE_NEW_VALUE) {
          selectedFilePath = selected
          fileContent = readLocalFile(cwd, selected)
        }

        name = await input({
          message: 'Item name (e.g. my-skill-name)',
          default: selectedFilePath ? deriveNameFromPath(selectedFilePath, platform, type) : undefined,
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
        authorsInput = await input({
          message: 'Co-authors (comma-separated GitHub usernames)',
          placeholder: 'e.g. octocat, torvalds',
        })
      } catch {
        console.log(ui.dim('Cancelled.'))
        process.exit(0)
      }

      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const extraAuthors = authorsInput
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
      const authors = [
        ...(currentUsername ? [currentUsername] : []),
        ...extraAuthors.filter((a) => a !== currentUsername),
      ]

      const config = getTypeConfig(platform, type)
      const { folder: typeFolder, defaultFile, target } = config

      let finalName: string
      let manifest: { name: string; type: RegistryItemType; description: string; tags: string[]; version: string; files: string[]; target: string; authors: string[] }

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
        const existingNames = new Set(
          (index[platform] ?? []).filter((i) => i.type === type).map((i) => i.name)
        )
        finalName = resolveFinalName(existingNames, name)
        if (finalName !== name) {
          console.log(ui.note('Name taken', `Using ${ui.bold(finalName)} (${name} already exists).`))
        }
      } else {
        finalName = name
      }

      // Registry path: <platform>/<typeFolder>/<name>
      const itemRegistryPath = `${platform}/${typeFolder}/${finalName}`
      manifest = {
        name: finalName,
        type,
        description: description || '',
        tags,
        version: '1.0.0',
        files: [defaultFile],
        target,
        authors,
      }

      const bodyContent =
        fileContent ?? (type === 'hook' ? '{}\n' : type === 'memory' ? `# Project Memory\n\n${description || ''}\n` : `# ${finalName}\n\n${description || ''}\n`)

      if (!createPr) {
        const scaffoldDir = join(cwd, 'gclib-registry-scaffold', platform, typeFolder, finalName)
        if (!existsSync(scaffoldDir)) {
          mkdirSync(scaffoldDir, { recursive: true })
        }
        writeFileSync(join(scaffoldDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
        writeFileSync(join(scaffoldDir, defaultFile), bodyContent, 'utf-8')
        console.log(ui.success(`Scaffolded at ${ui.path(scaffoldDir)}`))
        console.log(
          ui.note(
            'Open PR',
            `Next: clone gclib-registry, copy this folder to ${itemRegistryPath}/, push a branch, and run:\n  gh pr create --fill`
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

      const itemDir = join(tempDir, platform, typeFolder, finalName)
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
        indexData = JSON.parse(readLocalFile(tempDir, 'index.json') ?? '{}') as RegistryIndex
      } catch {
        console.error(ui.error('Invalid index.json in registry.'))
        console.log(ui.dim(`Temp dir left at: ${tempDir}`))
        process.exit(1)
      }
      const newItem: RawIndexItem = {
        name: finalName,
        type,
        description: description || '',
        tags,
        version: '1.0.0',
        authors,
        path: itemRegistryPath,
      }
      if (!indexData[platform]) {
        indexData[platform] = []
      }
      indexData[platform].push(newItem)
      writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')

      let branchName = `publish/${finalName}`
      try {
        execSync(`git checkout -b ${branchName}`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
        execSync(`git add "${platform}/${typeFolder}/${finalName}" index.json`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
        execSync(`git commit -m "Add ${platform}/${type}: ${finalName}"`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
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
          `gh pr create --repo ${REGISTRY_REPO} --head ${branchName} --title "Add ${platform}/${type}: ${finalName}" --body-file "${prBodyPath}"`,
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
