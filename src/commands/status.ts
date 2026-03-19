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
      const indexByName = new Map(allItems.map((i) => [i.name, i]))

      console.log(ui.title('Status'))
      console.log(
        `  ${ui.tableHeader('Name'.padEnd(26))} ${ui.tableHeader('Type'.padEnd(22))} ${ui.tableHeader('Installed'.padEnd(10))} ${ui.tableHeader('Latest'.padEnd(10))} ${ui.tableHeader('Status')}`
      )
      console.log(ui.dim('  ' + '-'.repeat(75)))

      for (const item of lockfile.items) {
        const latest = indexByName.get(item.name)
        const namePad = item.name.padEnd(26)
        const platformType = latest ? `${latest.platform}/${item.type}` : item.type
        const typePad = platformType.padEnd(22)
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
    })
}
