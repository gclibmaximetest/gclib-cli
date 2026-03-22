import type { Command } from 'commander'
import { checkbox, input, select } from '@inquirer/prompts'
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken, getGithubUsername } from '../lib/auth.js'
import { fetchIndex } from '../lib/registry.js'
import {
  REGISTRY_REPO,
  getTypeConfig,
  listLocalFiles,
  readLocalFile,
  isHigherVersion,
  isValidSemver,
  getAuthorNonCollectionItems,
  authorItemChoiceValue,
  buildCollectionRawItem,
  collectionRawItemToManifest,
  collectionReadmeMarkdown,
} from '../lib/publishShared.js'
import type { CollectionRawItem, IndexItem, Manifest, RawIndexItem, RegistryIndex } from '../types.js'

const NOT_LISTED_VALUE = '__not_listed__'
const NO_FILE_CHANGE_VALUE = '__no_file_change__'

function splitPlatformNameKey(key: string): [string, string] {
  const i = key.indexOf('::')
  return [key.slice(0, i), key.slice(i + 2)]
}

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Update an existing registry item and open a PR with the changes')
    .action(async () => {
      console.log(ui.title('gclib update'))

      checkPrerequisites()
      const token = getGithubToken()
      const currentUsername = getGithubUsername()
      const cwd = process.cwd()

      let index: RegistryIndex
      try {
        index = await fetchIndex(token)
      } catch (err) {
        console.error(ui.error('Failed to fetch registry index. Run `gh auth login` and ensure you have access to the registry.'))
        if (err instanceof Error) console.error(ui.dim(err.message))
        process.exit(1)
      }

      const allItems: IndexItem[] = [
        ...(index.githubcopilot ?? []).map((i) => ({ ...i, platform: 'githubcopilot' as const })),
        ...(index.claudecode ?? []).map((i) => ({ ...i, platform: 'claudecode' as const })),
        ...(index.collections ?? []).map((c) => ({ ...c, platform: 'collection' as const })),
      ]

      const myItems = currentUsername
        ? allItems.filter((i) => i.authors.includes(currentUsername))
        : allItems

      const itemChoices = [
        { value: NOT_LISTED_VALUE, name: 'Not listed? Publish a new item instead' },
        ...myItems.map((i) => ({
          value: `${i.platform}::${i.name}`,
          name: `${i.name}  ${ui.dim(`(${i.platform}/${i.type})`)}  ${i.description ? `— ${i.description}` : ''}`.trim(),
        })),
      ]

      if (myItems.length === 0) {
        console.log(ui.info('No items found with you as an author. Use `gclib publish` to add a new item.'))
        process.exit(0)
      }

      let selectedKey: string
      try {
        selectedKey = await select({
          message: 'Select item to update',
          choices: itemChoices,
        })
      } catch {
        console.log(ui.dim('Cancelled.'))
        process.exit(0)
      }

      if (selectedKey === NOT_LISTED_VALUE) {
        console.log(ui.info('Run `gclib publish` to add a new item to the registry.'))
        process.exit(0)
      }

      const [selectedPlatform, selectedName] = splitPlatformNameKey(selectedKey)
      const selectedItem = myItems.find(
        (i) => i.platform === selectedPlatform && i.name === selectedName
      ) as IndexItem

      const REGISTRY_BASE = 'https://raw.githubusercontent.com/gclibmaximetest/gclib-registry/main'

      if (selectedItem.type === 'collection') {
        const coll = selectedItem as CollectionRawItem & { platform: 'collection' }
        console.log(
          ui.note(
            'Updating',
            `collection: ${ui.bold(coll.name)}  (current version: ${coll.version})`
          )
        )

        let description: string
        let tagsInput: string
        let authorsInput: string
        let newVersion: string
        let selectedEntryKeys: string[]

        const authorItemsForPicker = getAuthorNonCollectionItems(index, currentUsername ?? null)

        try {
          description = await input({
            message: 'Description',
            default: coll.description,
          })
          tagsInput = await input({
            message: 'Tags (comma-separated)',
            default: coll.tags.join(', '),
          })
          const existingCoAuthors = coll.authors.filter((a) => a !== currentUsername)
          authorsInput = await input({
            message: 'Co-authors (comma-separated GitHub usernames)',
            default: existingCoAuthors.join(', '),
          })
          newVersion = await input({
            message: `Version (current: ${coll.version})`,
            default: bumpPatchVersion(coll.version),
            validate: (v) => {
              if (!isValidSemver(v)) return 'Version must be in x.x.x format (e.g. 1.2.3).'
              if (!isHigherVersion(coll.version, v))
                return `Version must be higher than the current version (${coll.version}).`
              return true
            },
          })

          const entrySet = new Set(coll.entries)
          selectedEntryKeys = await checkbox({
            message: 'Select entries in this collection',
            choices: authorItemsForPicker.map((row) => ({
              value: authorItemChoiceValue(row),
              name: `${row.name} ${ui.dim(`(${row.platform}/${row.type})`)}${row.description ? ` ${ui.dim(`— ${row.description}`)}` : ''}`.trim(),
              checked: entrySet.has(row.path),
            })),
            validate: (sel) => (sel.length > 0 ? true : 'Select at least one item.'),
          })
        } catch {
          console.log(ui.dim('Cancelled.'))
          process.exit(0)
        }

        const pathByChoice = new Map(
          authorItemsForPicker.map((r) => [authorItemChoiceValue(r), r.path])
        )
        const newEntries = selectedEntryKeys.map((k) => pathByChoice.get(k)!)

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

        const updatedCollection = buildCollectionRawItem({
          name: coll.name,
          description: description || '',
          tags,
          version: newVersion,
          authors,
          entries: newEntries,
        })

        const readmeContent = collectionReadmeMarkdown(coll.name, description)

        const tempDir = mkdtempSync(join(tmpdir(), 'gclib-registry-update-collection-'))
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

        const collectionDir = join(tempDir, coll.path)
        if (!existsSync(collectionDir)) mkdirSync(collectionDir, { recursive: true })
        writeFileSync(
          join(collectionDir, 'manifest.json'),
          `${JSON.stringify(collectionRawItemToManifest(updatedCollection), null, 2)}\n`,
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
          indexData = JSON.parse(readFileSync(indexPath, 'utf-8')) as RegistryIndex
        } catch {
          console.error(ui.error('Invalid index.json in registry.'))
          console.log(ui.dim(`Temp dir left at: ${tempDir}`))
          process.exit(1)
        }

        const collections = indexData.collections ?? []
        const idx = collections.findIndex((c) => c.name === coll.name)
        if (idx === -1) {
          console.error(ui.error(`Collection "${coll.name}" not found in cloned index.json.`))
          console.log(ui.dim(`Temp dir left at: ${tempDir}`))
          process.exit(1)
        }
        if (collections[idx]!.path !== coll.path) {
          console.error(ui.error('Collection path in index does not match expected path; aborting.'))
          process.exit(1)
        }
        collections[idx] = updatedCollection
        indexData.collections = collections
        writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')

        const branchNameBase = `update/collection-${coll.name}`
        let branchName = branchNameBase
        try {
          execSync(`git checkout -b ${branchName}`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
          execSync(`git add "${coll.path}" index.json`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
          execSync(`git commit -m "Update collection: ${coll.name} → ${newVersion}"`, {
            cwd: tempDir,
            stdio: 'pipe',
            encoding: 'utf-8',
          })

          for (let suffix = 0; ; suffix++) {
            const nameToPush = suffix === 0 ? branchName : `update/collection-${coll.name}-${suffix}`
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

        const prTitle = `Update collection: ${coll.name} → ${newVersion}`
        const prBody = description ? `${description}\n` : ''
        const prBodyPath = join(tmpdir(), `gclib-pr-body-${Date.now()}.txt`)
        try {
          writeFileSync(prBodyPath, prBody, 'utf-8')
          execSync(
            `gh pr create --repo ${REGISTRY_REPO} --head ${branchName} --title "${prTitle}" --body-file "${prBodyPath}"`,
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
        return
      }

      let existingManifest: Manifest
      try {
        const manifestRes = await fetch(`${REGISTRY_BASE}/${selectedItem.path}/manifest.json`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!manifestRes.ok) throw new Error(`HTTP ${manifestRes.status}`)
        existingManifest = (await manifestRes.json()) as Manifest
      } catch (err) {
        console.error(ui.error('Failed to fetch existing manifest from registry.'))
        if (err instanceof Error) console.error(ui.dim(err.message))
        process.exit(1)
      }

      console.log(
        ui.note(
          'Updating',
          `${selectedItem.platform}/${selectedItem.type}: ${ui.bold(selectedItem.name)}  (current version: ${existingManifest.version})`
        )
      )

      const platform = selectedItem.platform
      const type = selectedItem.type

      let description: string
      let tagsInput: string
      let authorsInput: string
      let newVersion: string
      let selectedFilePath: string | null = null
      let fileContent: string | null = null

      try {
        description = await input({
          message: 'Description',
          default: existingManifest.description,
        })

        tagsInput = await input({
          message: 'Tags (comma-separated)',
          default: existingManifest.tags.join(', '),
        })

        const existingCoAuthors = existingManifest.authors.filter((a) => a !== currentUsername)
        authorsInput = await input({
          message: 'Co-authors (comma-separated GitHub usernames)',
          default: existingCoAuthors.join(', '),
        })

        newVersion = await input({
          message: `Version (current: ${existingManifest.version})`,
          default: bumpPatchVersion(existingManifest.version),
          validate: (v) => {
            if (!isValidSemver(v)) return 'Version must be in x.x.x format (e.g. 1.2.3).'
            if (!isHigherVersion(existingManifest.version, v))
              return `Version must be higher than the current version (${existingManifest.version}).`
            return true
          },
        })

        const localFiles = listLocalFiles(cwd, platform, type)
        const fileChoices = [
          { value: NO_FILE_CHANGE_VALUE, name: `Keep existing file (${existingManifest.files[0] ?? 'unknown'})` },
          ...localFiles.map((f) => ({ value: f.value, name: f.name })),
        ]
        const selectedFile = await select({
          message: 'Source file',
          choices: fileChoices,
        })

        if (selectedFile !== NO_FILE_CHANGE_VALUE) {
          selectedFilePath = selectedFile
          fileContent = readLocalFile(cwd, selectedFile)
        }
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

      const updatedManifest: Manifest = {
        name: selectedItem.name,
        type,
        description: description || '',
        tags,
        version: newVersion,
        files: existingManifest.files,
        target,
        authors,
      }

      const tempDir = mkdtempSync(join(tmpdir(), 'gclib-registry-update-'))
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

      const itemDir = join(tempDir, platform, typeFolder, selectedItem.name)
      if (!existsSync(itemDir)) {
        mkdirSync(itemDir, { recursive: true })
      }

      writeFileSync(join(itemDir, 'manifest.json'), JSON.stringify(updatedManifest, null, 2), 'utf-8')

      if (fileContent !== null && selectedFilePath !== null) {
        const contentFileName = existingManifest.files[0] ?? defaultFile
        writeFileSync(join(itemDir, contentFileName), fileContent, 'utf-8')
      } else {
        // Fetch the existing file content from registry and keep it as-is
        try {
          const existingFileName = existingManifest.files[0] ?? defaultFile
          const fileRes = await fetch(`${REGISTRY_BASE}/${selectedItem.path}/${existingFileName}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (fileRes.ok) {
            const existingContent = await fileRes.text()
            writeFileSync(join(itemDir, existingFileName), existingContent, 'utf-8')
          }
        } catch {
          // Non-fatal: the file already exists in the cloned repo
        }
      }

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

      const platformItems = indexData[platform] ?? []
      const updatedIndexItem: RawIndexItem = {
        name: selectedItem.name,
        type,
        description: description || '',
        tags,
        version: newVersion,
        authors,
        path: selectedItem.path,
      }
      indexData[platform] = platformItems.map((i) =>
        i.name === selectedItem.name ? updatedIndexItem : i
      )
      writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf-8')

      let branchName = `update/${selectedItem.name}`
      try {
        execSync(`git checkout -b ${branchName}`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
        execSync(`git add "${platform}/${typeFolder}/${selectedItem.name}" index.json`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })
        execSync(`git commit -m "Update ${platform}/${type}: ${selectedItem.name} → ${newVersion}"`, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' })

        for (let suffix = 0; ; suffix++) {
          const nameToPush = suffix === 0 ? branchName : `update/${selectedItem.name}-${suffix}`
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

      const prTitle = `Update ${platform}/${type}: ${selectedItem.name} → ${newVersion}`
      const prBody = description ? `${description}\n` : ''
      const prBodyPath = join(tmpdir(), `gclib-pr-body-${Date.now()}.txt`)
      try {
        writeFileSync(prBodyPath, prBody, 'utf-8')
        execSync(
          `gh pr create --repo ${REGISTRY_REPO} --head ${branchName} --title "${prTitle}" --body-file "${prBodyPath}"`,
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

/** Increment the patch segment of a x.x.x version string. */
function bumpPatchVersion(version: string): string {
  const parts = version.split('.').map(Number)
  parts[2] = (parts[2] ?? 0) + 1
  return parts.join('.')
}
