import type { Command } from "commander";
import { checkbox, select } from "@inquirer/prompts";
import { ui } from "../lib/ui.js";
import { checkPrerequisites, getGithubToken } from "../lib/auth.js";
import { fetchItems, fetchFile } from "../lib/registry.js";
import { installItem } from "../lib/installer.js";
import { readLockfile, writeLockfile } from "../lib/lockfile.js";
import type { IndexItem, Manifest } from "../types.js";

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description("Interactively pick and install agents, skills, and instructions from the registry")
		.action(async () => {
			checkPrerequisites();
			const token = getGithubToken();
			const cwd = process.cwd();

			console.log(ui.title("gclib init"));

			const index = await fetchItems(token);
			if (index.length === 0) {
				console.log(ui.info("No items in the registry."));
				console.log(ui.outro("Done."));
				return;
			}

		const choices = index.map((i) => ({
        name: `${i.name} ${ui.dim(`(${i.platform}/${i.type})`)} ${i.description ? ui.dim(`— ${i.description}`) : ""}`.trim(),
        value: `${i.platform}::${i.name}`,
      }));

			let selected: string[];
			try {
				selected = await checkbox({
					message: "Select items to install",
					choices,
					required: false,
				});
			} catch {
				console.log(ui.dim("Cancelled."));
				process.exit(0);
			}

			if (!selected?.length) {
				console.log(ui.dim("No items selected."));
				process.exit(0);
			}

			const existingLock = readLockfile(cwd);
			const lockfile = existingLock ?? { version: "1", items: [] };

		for (const key of selected) {
        const [platform, name] = key.split('::') as [string, string]
        const item = index.find((i) => i.platform === platform && i.name === name) as IndexItem;
				const manifestPath = `${item.path}/manifest.json`;
				const manifestRaw = await fetchFile(token, manifestPath);
				const manifest = JSON.parse(manifestRaw) as Manifest;

				const fileContents = new Map<string, string>();
				for (const file of manifest.files) {
					const content = await fetchFile(token, `${item.path}/${file}`);
					fileContents.set(file, content);
				}

				const { written, skipped } = await installItem(cwd, manifest, fileContents, {
					cwd,
					onConflict: async (filePath) => {
						try {
							const action = await select({
								message: `File exists: ${ui.path(filePath)}`,
								choices: [
									{ value: "overwrite", name: "Overwrite" },
									{ value: "skip", name: "Skip" },
									{ value: "merge", name: "Merge (append below separator)" },
								],
							});
							return action as "overwrite" | "skip" | "merge";
						} catch {
							return "skip";
						}
					},
				});

				if (written.length || skipped.length) {
					const existing = lockfile.items.filter((i) => i.name !== item.name);
					lockfile.items = [
						...existing,
						{
							name: item.name,
							type: item.type,
							version: item.version,
							installedAt: new Date().toISOString(),
						},
					];
				}
			}

			writeLockfile(cwd, lockfile);
			console.log(ui.outro(`Installed ${selected.length} item(s).`));
		});
}
