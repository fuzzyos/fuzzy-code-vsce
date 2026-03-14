#!/usr/bin/env node
// Bundles @fuzzyos/fuzzy-code CLI into resources/fuzzy-code/cli-bundle.mjs
// and copies runtime assets (themes, export-html) that are loaded via readFileSync.

const { rm, mkdir, cp, writeFile } = require("fs/promises");
const { join, resolve } = require("path");
const { pathToFileURL } = require("url");

const monorepoRoot = resolve(__dirname, "..", "..", "..");
const fuzzyCodeDist = join(monorepoRoot, "node_modules", "@fuzzyos", "fuzzy-code", "dist");
const cliEntry = join(fuzzyCodeDist, "cli.js");
const packageRoot = join(__dirname, "..", "resources", "fuzzy-code");
const srcPkg = require(join(monorepoRoot, "node_modules", "@fuzzyos", "fuzzy-code", "package.json"));

(async () => {
	await rm(packageRoot, { recursive: true, force: true });
	await mkdir(packageRoot, { recursive: true });

	// Bundle CLI
	const { build } = await import(pathToFileURL(join(monorepoRoot, "node_modules", "esbuild", "lib", "main.js")).href);
	await build({
		entryPoints: [cliEntry],
		bundle: true,
		outfile: join(packageRoot, "cli-bundle.mjs"),
		platform: "node",
		format: "esm",
		logLevel: "warning",
		external: ["*.node"],
	});

	// Copy runtime assets loaded via readFileSync (relative to dist/)
	const assetDirs = [
		"modes/interactive/theme",
		"core/export-html",
		"core/export-html/vendor",
	];
	for (const dir of assetDirs) {
		await mkdir(join(packageRoot, "dist", dir), { recursive: true });
		await cp(join(fuzzyCodeDist, dir), join(packageRoot, "dist", dir), {
			recursive: true,
			filter: (src) => !src.endsWith(".js") && !src.endsWith(".map") && !src.endsWith(".ts"),
		});
	}

	// Wrapper that sets globalThis.require before loading the bundle
	const wrapper = [
		`import { createRequire } from "module";`,
		`globalThis.require = createRequire(import.meta.url);`,
		`await import("./cli-bundle.mjs");`,
	].join("\n") + "\n";

	await writeFile(join(packageRoot, "cli.mjs"), wrapper);
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({ type: "module", version: srcPkg.version }, null, 2) + "\n",
	);

	console.log(`Bundled @fuzzyos/fuzzy-code CLI → resources/fuzzy-code/cli.mjs`);
})();
