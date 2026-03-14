import type { Command } from 'commander'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken } from '../lib/auth.js'
import { fetchIndex } from '../lib/registry.js'
import type { IndexItem, RegistryItemType } from '../types.js'

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('Browse all available items in the registry')
    .option('-t, --type <type>', 'Filter by type: agent, skill, instruction')
    .option('--tag <tag>', 'Filter by tag (can be repeated)', (v: string, acc: string[] | undefined) => {
      const list = acc ?? []
      list.push(v)
      return list
    }, [] as string[])
    .action(async (options: { type?: string; tag?: string[] }) => {
      checkPrerequisites()
      const token = getGithubToken()
      const index = await fetchIndex(token)

      let items: IndexItem[] = index.items

      if (options.type) {
        const type = options.type as RegistryItemType
        if (['agent', 'skill', 'instruction'].includes(type)) {
          items = items.filter((i) => i.type === type)
        }
      }

      if (options.tag?.length) {
        const tags = new Set(options.tag.map((t) => t.toLowerCase()))
        items = items.filter((i) =>
          i.tags.some((t) => tags.has(t.toLowerCase()))
        )
      }

      if (items.length === 0) {
        console.log(ui.info('No items found.'))
        return
      }

      console.log(ui.title('Registry'))
      for (const item of items) {
        console.log(`  ${ui.bold(item.name)} ${ui.dim(`(${item.type})`)} — ${item.description}`)
        if (item.tags.length) {
          console.log(ui.dim(`    tags: ${item.tags.join(', ')}`))
        }
      }
    })
}
