# gclib

Internal CLI for managing AI configuration files (agents, skills, instructions, prompts, hooks, commands, memories) from a central registry across two platforms: **GitHub Copilot** and **Claude Code**. Run `gclib` in any project to pick and install items; access is gated by GitHub org membership via `gh` CLI.

## Prerequisites

- Node.js 18+
- [GitHub CLI](https://cli.github.com/) installed and authenticated:

  ```bash
  gh auth login
  ```

## Install

From your internal npm registry, or directly from GitHub:

```bash
npm install -g gclib
# or
npm install -g github:gclibmaximetest/gclib-cli
```

For local development:

```bash
npm run install:local
```

## Commands

| Command | Description |
|--------|-------------|
| `gclib init` | Interactive multi-select: pick items from the registry and install them |
| `gclib add <name>` | Add a specific item by name. Use `--overwrite` or `--skip` for existing files |
| `gclib list` | List all registry items. Filter with `--platform githubcopilot\|claudecode`, `--type <type>`, `--tag <tag>` |
| `gclib status` | Show installed items and whether they are up to date |
| `gclib sync` | Update installed items to latest versions (prompts before overwrite; use `--yes` to skip) |
| `gclib publish` | Scaffold a new registry item and open a PR |
| `gclib update` | Update an existing registry item you authored and open a PR with the changes |

### Platforms & item types

| Platform | Item types |
|----------|-----------|
| `githubcopilot` | `agent`, `skill`, `instruction`, `prompt`, `hook` |
| `claudecode` | `agent`, `skill`, `command`, `memory` |

## Configuration

- **Registry**: Items are fetched from [`gclibmaximetest/gclib-registry`](https://github.com/gclibmaximetest/gclib-registry).
- **Lock file**: After install, the project will have a `gclib.lock.json` listing installed items; commit it so `gclib sync` and `gclib status` work for the whole team.

## Development

```bash
npm install
npm run build
node dist/index.js list
```

Or with watch:

```bash
npm run dev
```

## License

Internal use only.
