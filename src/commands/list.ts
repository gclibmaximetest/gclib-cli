import type { Command } from 'commander'
import { ui } from '../lib/ui.js'
import { checkPrerequisites, getGithubToken } from '../lib/auth.js'
import { fetchItems } from '../lib/registry.js'
import type { IndexItem, RegistryItemType, RegistryPlatform } from '../types.js'

const ALL_TYPES: RegistryItemType[] = [
  'agent',
  'skill',
  'instruction',
  'prompt',
  'hook',
  'command',
  'memory',
  'collection',
]

const PLATFORM_ORDER: RegistryPlatform[] = ['githubcopilot', 'claudecode', 'collection']

const PLATFORM_LABEL: Record<RegistryPlatform, string> = {
  githubcopilot: 'GitHub Copilot',
  claudecode: 'Claude Code',
  collection: 'Collection',
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('Browse all available items in the registry')
    .option('-p, --platform <platform>', 'Filter by platform: githubcopilot, claudecode, collection')
    .option(
      '-t, --type <type>',
      'Filter by type: agent, skill, instruction, prompt, hook, command, memory, collection'
    )
    .option('--tag <tag>', 'Filter by tag (can be repeated)', (v: string, acc: string[] | undefined) => {
      const list = acc ?? []
      list.push(v)
      return list
    }, [] as string[])
    .action(async (options: { platform?: string; type?: string; tag?: string[] }) => {
      checkPrerequisites()
      const token = getGithubToken()
      let items: IndexItem[] = await fetchItems(token)

      if (options.platform) {
        const platform = options.platform as RegistryPlatform
        if (['githubcopilot', 'claudecode', 'collection'].includes(platform)) {
          items = items.filter((i) => i.platform === platform)
        }
      }

      if (options.type) {
        const type = options.type as RegistryItemType
        if (ALL_TYPES.includes(type)) {
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

      const byPlatform = new Map<RegistryPlatform, IndexItem[]>()
      for (const item of items) {
        const group = byPlatform.get(item.platform)
        if (group) group.push(item)
        else byPlatform.set(item.platform, [item])
      }

      console.log(ui.title('Registry'))
      for (const platform of PLATFORM_ORDER) {
        const platformItems = byPlatform.get(platform)
        if (!platformItems?.length) continue

        console.log(`  ${ui.subtitle(PLATFORM_LABEL[platform])}\n`)

        const byType = new Map<RegistryItemType, IndexItem[]>()
        for (const item of platformItems) {
          const tGroup = byType.get(item.type)
          if (tGroup) tGroup.push(item)
          else byType.set(item.type, [item])
        }

        for (const type of ALL_TYPES) {
          const typeItems = byType.get(type)
          if (!typeItems?.length) continue

          console.log(`    ${ui.tableHeader(type)}`)
          for (const item of typeItems) {
            console.log(`      ${ui.bold(item.name)} — ${item.description}`)
            if (item.tags.length) {
              console.log(ui.dim(`        tags: ${item.tags.join(', ')}`))
            }
          }
          console.log()
        }
      }
    })
}
