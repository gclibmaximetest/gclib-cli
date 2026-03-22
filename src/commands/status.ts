import type { Command } from 'commander'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken } from '../lib/auth.js'
import { fetchItems } from '../lib/registry.js'
import { readLockfile } from '../lib/lockfile.js'

const NAME_W = 26
const TYPE_W = 14
const VER_W = 10

/** Split a long name across lines; prefer breaking after `-` within the column width. */
function wrapNameForTable(name: string): string[] {
  if (name.length <= NAME_W) return [name]
  const lines: string[] = []
  let rest = name
  while (rest.length > NAME_W) {
    const slice = rest.slice(0, NAME_W)
    const hyphenAt = slice.lastIndexOf('-')
    const cut = hyphenAt > 0 ? hyphenAt + 1 : NAME_W
    lines.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.length) lines.push(rest)
  return lines
}

function printStatusTableRow(
  name: string,
  type: string,
  inst: string,
  latest: string,
  status: string
): void {
  const nameLines = wrapNameForTable(name)
  const typePad = type.padEnd(TYPE_W)
  const instPad = inst.padEnd(VER_W)
  const latestPad = latest.padEnd(VER_W)
  const blankMid = `${''.padEnd(TYPE_W)} ${''.padEnd(VER_W)} ${''.padEnd(VER_W)} `
  for (let i = 0; i < nameLines.length; i++) {
    const namePad = nameLines[i]!.padEnd(NAME_W)
    if (i === 0) {
      console.log(`  ${namePad} ${typePad} ${instPad} ${latestPad} ${status}`)
    } else {
      console.log(`  ${namePad} ${blankMid}`)
    }
  }
}

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

      const platforms = ['githubcopilot', 'claudecode', 'collection'] as const
      const header = `  ${ui.tableHeader('Name'.padEnd(NAME_W))} ${ui.tableHeader('Type'.padEnd(TYPE_W))} ${ui.tableHeader('Installed'.padEnd(VER_W))} ${ui.tableHeader('Latest'.padEnd(VER_W))} ${ui.tableHeader('Status')}`
      const divider = ui.dim(
        '  ' + '-'.repeat(NAME_W + 1 + TYPE_W + 1 + VER_W + 1 + VER_W)
      )

      console.log(ui.title('Status'))

      for (const platform of platforms) {
        const platformItems = migratedItems.filter((i) => i.platform === platform)
        if (!platformItems.length) continue

        console.log(`  ${ui.subtitle(platform)}\n`)
        console.log(header)
        console.log(divider)

        for (const item of platformItems) {
          const latest = indexByKey.get(`${item.platform}::${item.name}`)
          const latestVer = latest?.version ?? '—'
          const status = !latest
            ? ui.warning('not in registry')
            : latest.version !== item.version
              ? ui.warning('outdated')
              : ui.success('up to date')
          printStatusTableRow(item.name, item.type, item.version, latestVer, status)
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
          printStatusTableRow(
            item.name,
            item.type,
            item.version,
            '—'.padEnd(VER_W),
            ui.warning('not in registry')
          )
        }
        console.log()
      }
    })
}
