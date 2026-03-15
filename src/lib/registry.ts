import type { RegistryIndex } from "../types.js";

const REGISTRY_BASE = "https://raw.githubusercontent.com/gclibmaximetest/gclib-registry/main";

export async function fetchIndex(token: string): Promise<RegistryIndex> {
	const res = await fetch(`${REGISTRY_BASE}/index.json`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (res.status === 401 || res.status === 404) {
		throw new Error("❌ Access denied. Are you a member of the organisation?");
	}
	return res.json() as Promise<RegistryIndex>;
}

export async function fetchFile(token: string, path: string): Promise<string> {
	const res = await fetch(`${REGISTRY_BASE}/${path}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		const url = `${REGISTRY_BASE}/${path}`;
		throw new Error(`Failed to fetch ${path} (${res.status}) — ${url}`);
	}
	return res.text();
}
