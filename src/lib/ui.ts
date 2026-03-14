import chalk from 'chalk'

export const ui = {
  title: (text: string) => chalk.bold.cyan(`\n  ${text}\n`),
  subtitle: (text: string) => chalk.cyan(text),
  success: (text: string) => chalk.green('✓ ' + text),
  error: (text: string) => chalk.red('✗ ' + text),
  warning: (text: string) => chalk.yellow('⚠ ' + text),
  info: (text: string) => chalk.blue('ℹ ' + text),
  dim: (text: string) => chalk.dim(text),
  bold: (text: string) => chalk.bold(text),
  path: (text: string) => chalk.cyan(text),
  tag: (text: string) => chalk.dim.italic(text),
  tableHeader: (text: string) => chalk.bold(text),
  outro: (text: string) => chalk.green(`\n  ${text}\n`),
  note: (label: string, body: string) =>
    chalk.dim(`\n  ${chalk.bold(label)}\n  ${body.split('\n').join('\n  ')}\n`),
}
