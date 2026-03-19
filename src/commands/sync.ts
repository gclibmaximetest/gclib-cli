import type { Command } from 'commander'
import { confirm } from '@inquirer/prompts'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken } from '../lib/auth.js'
import { fetchItems, fetchFile } from '../lib/registry.js'
import { installItem } from '../lib/installer.js'
import { readLockfile, upsertLockfileItem } from '../lib/lockfile.js'
import type { Manifest } from '../types.js'

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Update installed items to latest versions from the registry')
    .option('-y, --yes', 'Skip confirmation and overwrite outdated files')
    .action(async (options: { yes?: boolean }) => {
      checkPrerequisites()
      const token = getGithubToken()
      const cwd = process.cwd()

      const lockfile = readLockfile(cwd)
      if (!lockfile?.items.length) {
        console.log(ui.info('No gclib items installed. Run `gclib init` or `gclib add <name>`.'))
        return
      }

      const allItems = await fetchItems(token)
      const indexByName = new Map(allItems.map((i) => [i.name, i]))

      const outdated = lockfile.items.filter((item) => {
        const latest = indexByName.get(item.name)
        return latest && latest.version !== item.version
      })

      if (outdated.length === 0) {
        console.log(ui.success('All installed items are up to date.'))
        return
      }

      if (!options.yes) {
        let confirmed: boolean
        try {
          confirmed = await confirm({
            message: `Update ${ui.bold(String(outdated.length))} outdated item(s)?`,
            default: true,
          })
        } catch {
          console.log(ui.dim('Sync cancelled.'))
          process.exit(0)
        }
        if (!confirmed) {
          console.log(ui.dim('Sync cancelled.'))
          process.exit(0)
        }
      }

      for (const item of outdated) {
        const latest = indexByName.get(item.name)!
        const manifestPath = `${latest.path}/manifest.json`
        const manifestRaw = await fetchFile(token, manifestPath)
        const manifest = JSON.parse(manifestRaw) as Manifest

        const fileContents = new Map<string, string>()
        for (const file of manifest.files) {
          const content = await fetchFile(token, `${latest.path}/${file}`)
          fileContents.set(file, content)
        }

        await installItem(cwd, manifest, fileContents, {
          cwd,
          conflictMode: 'overwrite',
        })
        upsertLockfileItem(cwd, {
          name: latest.name,
          type: latest.type,
          version: latest.version,
          installedAt: new Date().toISOString(),
        })
        console.log(ui.success(`Updated ${ui.bold(latest.name)} to ${latest.version}`))
      }

      console.log(ui.outro('Sync complete.'))
    })
}
