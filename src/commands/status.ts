import type { Command } from 'commander'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken } from '../lib/auth.js'
import { fetchItems } from '../lib/registry.js'
import { readLockfile } from '../lib/lockfile.js'

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show installed items and whether they are up to date')
    .action(async () => {
      checkPrerequisites()
      const token = getGithubToken()
      const cwd = process.cwd()

      const lockfile = readLockfile(cwd)
      if (!lockfile?.items.length) {
        console.log(ui.info('No gclib items installed. Run `gclib init` or `gclib add <name>`.'))
        return
      }

      const allItems = await fetchItems(token)
      const indexByKey = new Map(allItems.map((i) => [`${i.platform}::${i.name}`, i]))

      // Migrate lock items missing platform by matching against the registry index
      const migratedItems = lockfile.items.map((item) => {
        if (item.platform) return item
        const match = allItems.find((i) => i.name === item.name && i.type === item.type)
        return match ? { ...item, platform: match.platform } : item
      })

      const platforms = ['githubcopilot', 'claudecode'] as const
      const header = `  ${ui.tableHeader('Name'.padEnd(26))} ${ui.tableHeader('Type'.padEnd(14))} ${ui.tableHeader('Installed'.padEnd(10))} ${ui.tableHeader('Latest'.padEnd(10))} ${ui.tableHeader('Status')}`
      const divider = ui.dim('  ' + '-'.repeat(67))

      console.log(ui.title('Status'))

      for (const platform of platforms) {
        const platformItems = migratedItems.filter((i) => i.platform === platform)
        if (!platformItems.length) continue

        console.log(`  ${ui.subtitle(platform)}\n`)
        console.log(header)
        console.log(divider)

        for (const item of platformItems) {
          const latest = indexByKey.get(`${item.platform}::${item.name}`)
          const namePad = item.name.padEnd(26)
          const typePad = item.type.padEnd(14)
          const instPad = item.version.padEnd(10)
          const latestVer = latest?.version ?? '—'
          const latestPad = latestVer.padEnd(10)
          const status = !latest
            ? ui.warning('not in registry')
            : latest.version !== item.version
              ? ui.warning('outdated')
              : ui.success('up to date')
          console.log(`  ${namePad} ${typePad} ${instPad} ${latestPad} ${status}`)
        }

        console.log()
      }

      // Items with no recognised platform (legacy / unmatched)
      const unknownItems = migratedItems.filter((i) => !i.platform)
      if (unknownItems.length) {
        console.log(`  ${ui.subtitle('unknown')}\n`)
        console.log(header)
        console.log(divider)
        for (const item of unknownItems) {
          const namePad = item.name.padEnd(26)
          const typePad = item.type.padEnd(14)
          const instPad = item.version.padEnd(10)
          console.log(`  ${namePad} ${typePad} ${instPad} ${'—'.padEnd(10)} ${ui.warning('not in registry')}`)
        }
        console.log()
      }
    })
}
