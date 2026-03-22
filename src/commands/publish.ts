import type { Command } from 'commander'
import { checkbox, input, select } from '@inquirer/prompts'
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
  getAuthorNonCollectionItems,
  authorItemChoiceValue,
  buildCollectionRawItem,
  collectionRawItemToManifest,
  collectionReadmeMarkdown,
} from '../lib/publishShared.js'
import type { LockfilePlatform, RawIndexItem, RegistryIndex, RegistryItemType } from '../types.js'

type PublishableItemType = Exclude<RegistryItemType, 'collection'>

const CREATE_NEW_VALUE = '__create_new__'

/** Resolve unique name using registry index: name, or name-2, name-3, ... if taken. */
function resolveFinalName(existingNames: Set<string>, name: string): string {
  if (!existingNames.has(name)) return name
  let n = 2
  while (existingNames.has(`${name}-${n}`)) n += 1
  return `${name}-${n}`
}

async function publishCollectionFlow(options: {
  createPr: boolean
  currentUsername: string | null
  cwd: string
}): Promise<void> {
  const { createPr, currentUsername, cwd } = options

  if (!currentUsername) {
    console.error(
      ui.error(
        'Publishing a collection requires a GitHub username. Run `gh auth login` so your authored index items can be listed.'
      )
    )
    process.exit(1)
  }

  if (createPr) checkPrerequisites()
  const token = getGithubToken()
  let index: RegistryIndex
  try {
    index = await fetchIndex(token)
  } catch (err) {
    console.error(
      ui.error('Failed to fetch registry index. Run `gh auth login` and ensure you have access to the registry.')
    )
    if (err instanceof Error) console.error(ui.dim(err.message))
    process.exit(1)
  }

  const authorItems = getAuthorNonCollectionItems(index, currentUsername)
  if (authorItems.length === 0) {
    console.log(ui.info('No index items found that you author. Publish single items first, then create a collection.'))
    process.exit(0)
  }

  const pathByChoice = new Map(authorItems.map((r) => [authorItemChoiceValue(r), r.path]))

  let selectedKeys: string[]
  try {
    selectedKeys = await checkbox({
      message: 'Select entries to include in the collection',
      choices: authorItems.map((row) => ({
        value: authorItemChoiceValue(row),
        name: `${row.name} ${ui.dim(`(${row.platform}/${row.type})`)}${row.description ? ` ${ui.dim(`— ${row.description}`)}` : ''}`.trim(),
      })),
      validate: (sel) => (sel.length > 0 ? true : 'Select at least one item.'),
    })
  } catch {
    console.log(ui.dim('Cancelled.'))
    process.exit(0)
  }

  const entries = selectedKeys.map((k) => pathByChoice.get(k)!).filter(Boolean)

  let name: string
  let description: string
  let tagsInput: string
  let authorsInput: string
  try {
    name = await input({
      message: 'Collection name (e.g. my-bundle)',
      validate: (v) => {
        if (!/^[a-z0-9-]+$/.test(v)) return 'Use only lowercase letters, numbers, and hyphens.'
        return true
      },
    })
    description = await input({ message: 'Short description' })
    tagsInput = await input({
      message: 'Tags (comma-separated)',
      placeholder: 'e.g. typescript, bundle',
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

  const existingCollectionNames = new Set((index.collections ?? []).map((c) => c.name))
  const finalName = createPr ? resolveFinalName(existingCollectionNames, name) : name
  if (createPr && finalName !== name) {
    console.log(ui.note('Name taken', `Using ${ui.bold(finalName)} (${name} already exists).`))
  }

  const collectionPath = `collections/${finalName}`
  const readmeContent = collectionReadmeMarkdown(finalName, description)
  const newCollection = buildCollectionRawItem({
    name: finalName,
    description: description || '',
    tags,
    version: '1.0.0',
    authors,
    entries,
  })

  if (!createPr) {
    const scaffoldDir = join(cwd, 'gclib-registry-scaffold', collectionPath)
    if (!existsSync(scaffoldDir)) mkdirSync(scaffoldDir, { recursive: true })
    writeFileSync(
      join(scaffoldDir, 'manifest.json'),
      `${JSON.stringify(collectionRawItemToManifest(newCollection), null, 2)}\n`,
      'utf-8'
    )
    writeFileSync(join(scaffoldDir, 'README.md'), readmeContent, 'utf-8')
    console.log(ui.success(`Scaffolded collection at ${ui.path(scaffoldDir)}`))
    console.log(
      ui.note(
        'Open PR',
        `Copy this folder to the registry as ${collectionPath}/, add a matching entry to index.json \`collections\` (path + entries), push a branch, and run:\n  gh pr create --fill`
      )
    )
    console.log(ui.outro('Done.'))
    return
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'gclib-registry-publish-collection-'))
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

  const collectionDir = join(tempDir, collectionPath)
  mkdirSync(collectionDir, { recursive: true })
  writeFileSync(
    join(collectionDir, 'manifest.json'),
    `${JSON.stringify(collectionRawItemToManifest(newCollection), null, 2)}\n`,
    'utf-8'
  )
  writeFileSync(join(collectionDir, 'README.md'), readmeContent, 'utf-8')

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
  if (!indexData.collections) indexData.collections = []
  indexData.collections.push(newCollection)
  writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')

  const branchNameBase = `publish/collection-${finalName}`
  let branchName = branchNameBase
  try {
    execSync(`git checkout -b ${branchName}`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
    execSync(`git add "${collectionPath}" index.json`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
    execSync(`git commit -m "Add collection: ${finalName}"`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
    for (let suffix = 0; ; suffix++) {
      const nameToPush = suffix === 0 ? branchName : `publish/collection-${finalName}-${suffix}`
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
      `gh pr create --repo ${REGISTRY_REPO} --head ${branchName} --title "Add collection: ${finalName}" --body-file "${prBodyPath}"`,
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
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish')
    .description('Scaffold a new item and open a PR to the registry')
    .option('--no-pr', 'Only scaffold locally; do not create a PR')
    .action(async (options: { pr?: boolean }) => {
      const createPr = options.pr !== false

      console.log(ui.title('gclib publish'))

      const cwd = process.cwd()
      const currentUsername = getGithubUsername()

      let publishKind: 'item' | 'collection'
      try {
        publishKind = await select({
          message: 'What to publish?',
          choices: [
            { value: 'item' as const, name: 'Single item (agent, skill, …)' },
            { value: 'collection' as const, name: 'Collection (bundle of your items)' },
          ],
        })
      } catch {
        console.log(ui.dim('Cancelled.'))
        process.exit(0)
      }

      if (publishKind === 'collection') {
        await publishCollectionFlow({ createPr, currentUsername, cwd })
        return
      }

      let name: string
      let platform: LockfilePlatform
      let type: PublishableItemType
      let description: string
      let tagsInput: string
      let authorsInput: string

      let selectedFilePath: string | null = null
      let fileContent: string | null = null

      try {
        platform = await select({
          message: 'Platform',
          choices: [
            { value: 'githubcopilot' as LockfilePlatform, name: 'GitHub Copilot' },
            { value: 'claudecode' as LockfilePlatform, name: 'Claude Code' },
          ],
        })

        const typeChoices =
          platform === 'githubcopilot'
            ? GITHUBCOPILOT_TYPES.map((t) => ({ value: t as PublishableItemType, name: t }))
            : CLAUDECODE_TYPES.map((t) => ({ value: t as PublishableItemType, name: t }))

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
      let manifest: {
        name: string
        type: PublishableItemType
        description: string
        tags: string[]
        version: string
        files: string[]
        target: string
        authors: string[]
      }

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
