import type { Command } from 'commander'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken } from '../lib/auth.js'
import { fetchItems } from '../lib/registry.js'
import { installFromRegistryPath } from '../lib/registryInstall.js'
import { upsertLockfileItem } from '../lib/lockfile.js'
import type { RegistryPlatform } from '../types.js'

export function registerAddCommand(program: Command): void {
  program
    .command('add <name>')
    .description('Add a specific item from the registry by name')
    .option('-o, --overwrite', 'Overwrite existing files')
    .option('-s, --skip', 'Skip existing files')
    .option('-p, --platform <platform>', 'Disambiguate by platform when the same name exists on multiple platforms: githubcopilot, claudecode')
    .action(async (name: string, options: { overwrite?: boolean; skip?: boolean; platform?: string }) => {
      checkPrerequisites()
      const token = getGithubToken()
      const cwd = process.cwd()

      const items = await fetchItems(token)
      let matches = items.filter(
        (i) => i.name.toLowerCase() === name.toLowerCase()
      )

      if (options.platform) {
        const platform = options.platform as RegistryPlatform
        matches = matches.filter((i) => i.platform === platform)
      }

      if (matches.length === 0) {
        console.error(ui.error(`Item not found: ${name}`))
        process.exit(1)
      }

      if (matches.length > 1) {
        console.error(
          ui.error(
            `Multiple items named "${name}" found (${matches.map((i) => i.platform).join(', ')}). Use --platform to specify one.`
          )
        )
        process.exit(1)
      }

      const item = matches[0]!

      const conflictMode = options.overwrite ? 'overwrite' : options.skip ? 'skip' : 'overwrite'
      const installOpts = { cwd, conflictMode } as const

      const pathsToInstall =
        item.type === 'collection' ? item.entries : [item.path]

      const collectionContext =
        item.type === 'collection' ? { collectionName: item.name } : undefined

      let anyCollectionMemberWritten = false

      for (const registryPath of pathsToInstall) {
        const { written, skipped, name, type, platform, version } = await installFromRegistryPath(
          token,
          cwd,
          registryPath,
          installOpts,
          collectionContext
        )

        if (written.length) {
          if (item.type === 'collection') anyCollectionMemberWritten = true
          upsertLockfileItem(cwd, {
            name,
            type,
            platform,
            version,
            installedAt: new Date().toISOString(),
          })
          console.log(ui.success(`Installed ${ui.bold(name)} ${ui.dim(`(${version})`)}`))
          written.forEach((p) => console.log(ui.dim('  ') + ui.path(p)))
        }
        if (skipped.length) {
          console.log(ui.dim('Skipped (already exist):'))
          skipped.forEach((p) => console.log(ui.dim('  ') + p))
        }
      }

      if (item.type === 'collection' && anyCollectionMemberWritten) {
        upsertLockfileItem(cwd, {
          name: item.name,
          type: 'collection',
          platform: 'collection',
          version: item.version,
          installedAt: new Date().toISOString(),
        })
      }
    })
}
