# gclib

Internal CLI for managing GitHub Copilot configuration files (agents, skills, instructions) from a central registry. Run `gclib` in any project to pick and install Copilot files; access is gated by GitHub org membership via `gh` CLI.

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
npm install -g github:your-org/gclib-cli
```

## Commands

| Command | Description |
|--------|-------------|
| `gclib init` | Interactive multi-select: pick items from the registry and install |
| `gclib add <name>` | Add a specific item by name (e.g. in scripts). Use `--overwrite` or `--skip` for existing files |
| `gclib list` | List all registry items. Optional: `--type skill`, `--tag typescript` |
| `gclib status` | Show installed items and whether they are up to date |
| `gclib sync` | Update installed items to latest versions (prompts before overwrite; use `--yes` to skip) |
| `gclib publish` | Scaffold a new registry item and get instructions to open a PR |

## Configuration

- **Registry URL**: Edit `src/lib/registry.ts` and replace `your-org` with your GitHub organisation, or use `~/.gclib/config.json` (see `src/lib/config.ts`) when overrides are implemented.
- **Lock file**: After install, the project will have a `gclib.lock.json` listing installed items; commit it so `gclib sync` and `gclib status` work for the team.

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
