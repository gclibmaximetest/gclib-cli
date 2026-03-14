import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_DIR = join(homedir(), '.gclib')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export interface GclibConfig {
  registryBase?: string
}

const defaultConfig: GclibConfig = {}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function readConfig(): GclibConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...defaultConfig }
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    return { ...defaultConfig, ...JSON.parse(raw) }
  } catch {
    return { ...defaultConfig }
  }
}

export function writeConfig(config: GclibConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}
