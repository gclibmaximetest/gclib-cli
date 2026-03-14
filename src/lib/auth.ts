import { execSync } from 'child_process'
import { ui } from './ui.js'

export function getGithubToken(): string {
  try {
    return execSync('gh auth token', { encoding: 'utf-8' }).trim()
  } catch {
    throw new Error(
      'Not authenticated with GitHub CLI. Run `gh auth login` first.'
    )
  }
}

export function checkPrerequisites(): void {
  try {
    execSync('gh auth status', { stdio: 'ignore' })
  } catch {
    console.error(ui.error('Please run `gh auth login` before using gclib'))
    process.exit(1)
  }
}
