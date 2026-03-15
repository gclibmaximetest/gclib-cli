#!/usr/bin/env node

import { Command } from 'commander'
import { getLocalVersion, runVersionCheck } from './lib/versionCheck.js'
import { registerListCommand } from './commands/list.js'
import { registerAddCommand } from './commands/add.js'
import { registerInitCommand } from './commands/init.js'
import { registerSyncCommand } from './commands/sync.js'
import { registerStatusCommand } from './commands/status.js'
import { registerPublishCommand } from './commands/publish.js'

const program = new Command()

program
  .name('gclib')
  .description('Internal CLI for managing GitHub Copilot configuration files')
  .version(getLocalVersion())

registerListCommand(program)
registerAddCommand(program)
registerInitCommand(program)
registerSyncCommand(program)
registerStatusCommand(program)
registerPublishCommand(program)

;(async () => {
  await runVersionCheck()
  program.parse()
})()
