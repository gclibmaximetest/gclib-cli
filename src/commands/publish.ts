import type { Command } from 'commander'
import { input, select } from '@inquirer/prompts'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { ui } from '../lib/ui.js'
import type { RegistryItemType } from '../types.js'

const TYPES: RegistryItemType[] = ['agent', 'skill', 'instruction']

const DEFAULT_FILES: Record<RegistryItemType, string> = {
  agent: 'agent.yml',
  skill: 'skill.md',
  instruction: 'instructions.md',
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish')
    .description('Scaffold a new item and open a PR to the registry')
    .action(async () => {
      console.log(ui.title('gclib publish'))

      let name: string
      let type: RegistryItemType
      let description: string
      let tagsInput: string

      try {
        name = await input({
          message: 'Item name (e.g. my-skill-name)',
          validate: (v) => {
            if (!/^[a-z0-9-]+$/.test(v)) return 'Use only lowercase letters, numbers, and hyphens.'
            return true
          },
        })
        type = await select({
          message: 'Type',
          choices: TYPES.map((t) => ({ value: t, name: t })),
        }) as RegistryItemType
        description = await input({ message: 'Short description' })
        tagsInput = await input({
          message: 'Tags (comma-separated)',
          placeholder: 'e.g. typescript, linting',
        })
      } catch {
        console.log(ui.dim('Cancelled.'))
        process.exit(0)
      }

      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      const fileName = DEFAULT_FILES[type]
      const manifest = {
        name,
        type,
        description: description || '',
        tags,
        version: '1.0.0',
        files: [fileName],
        target: `.github/${type}s/`,
      }

      const scaffoldDir = join(process.cwd(), 'gclib-registry-scaffold', type + 's', name)
      if (!existsSync(scaffoldDir)) {
        mkdirSync(scaffoldDir, { recursive: true })
      }

      writeFileSync(
        join(scaffoldDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      )
      writeFileSync(
        join(scaffoldDir, fileName),
        `# ${name}\n\n${description || ''}\n`,
        'utf-8'
      )

      console.log(ui.success(`Scaffolded at ${ui.path(scaffoldDir)}`))
      console.log(
        ui.note(
          'Open PR',
          'Next: clone gclib-registry, copy this folder in, push a branch, and run:\n  gh pr create --fill'
        )
      )
      console.log(ui.outro('Done.'))
    })
}
