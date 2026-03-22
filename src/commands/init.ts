import type { Command } from "commander";
import { checkbox, select } from "@inquirer/prompts";
import { ui } from "../lib/ui.js";
import { checkPrerequisites, getGithubToken } from "../lib/auth.js";
import { fetchItems } from "../lib/registry.js";
import { installFromRegistryPath } from "../lib/registryInstall.js";
import { readLockfile, writeLockfile } from "../lib/lockfile.js";
import type { IndexItem, LockfileItem, RegistryPlatform } from "../types.js";

function mergeLockfileItem(items: LockfileItem[], next: LockfileItem): LockfileItem[] {
	const existing = items.filter((i) => !(i.name === next.name && i.platform === next.platform));
	return [...existing, next];
}

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description("Interactively pick and install agents, skills, instructions, and collections from the registry")
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
			let lockfile = existingLock ?? { version: "1", items: [] };

			const conflictOptions = {
				cwd,
				onConflict: async (filePath: string) => {
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
			};

			let installedCount = 0;

			const recordInstall = (result: {
				written: string[];
				skipped: string[];
				name: string;
				type: LockfileItem["type"];
				platform: RegistryPlatform;
				version: string;
			}) => {
				if (!result.written.length && !result.skipped.length) return;
				installedCount += 1;
				lockfile.items = mergeLockfileItem(lockfile.items, {
					name: result.name,
					type: result.type,
					platform: result.platform,
					version: result.version,
					installedAt: new Date().toISOString(),
				});
			};

			for (const key of selected) {
				const sep = key.indexOf("::");
				const platformKey = sep === -1 ? key : key.slice(0, sep);
				const name = sep === -1 ? "" : key.slice(sep + 2);
				const item = index.find((i) => i.platform === platformKey && i.name === name) as IndexItem | undefined;
				if (!item) continue;

				if (item.type === "collection") {
					let anyCollectionMember = false;
					for (const entryPath of item.entries) {
						const result = await installFromRegistryPath(token, cwd, entryPath, conflictOptions, {
							collectionName: item.name,
						});
						recordInstall(result);
						if (result.written.length || result.skipped.length) anyCollectionMember = true;
					}
					if (anyCollectionMember) {
						lockfile.items = mergeLockfileItem(lockfile.items, {
							name: item.name,
							type: "collection",
							platform: "collection",
							version: item.version,
							installedAt: new Date().toISOString(),
						});
					}
				} else {
					const result = await installFromRegistryPath(token, cwd, item.path, conflictOptions);
					recordInstall(result);
				}
			}

			writeLockfile(cwd, lockfile);
			console.log(ui.outro(`Installed ${installedCount} item(s).`));
		});
}
