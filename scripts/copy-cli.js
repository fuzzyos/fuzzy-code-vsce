#!/usr/bin/env node
// Copies the @fuzzyos/fuzzy-code dist into resources/fuzzy-code/
// so it can be bundled into the VSIX and used without a global install.

const { cp, mkdir, writeFile } = require("fs/promises");
const { join, resolve } = require("path");

// In an npm workspace the symlink lives at the monorepo root node_modules.
// Walk up from this script's location to find it.
const monorepoRoot = resolve(__dirname, "..", "..", "..");
const distDir = join(
	monorepoRoot,
	"node_modules",
	"@fuzzyos",
	"fuzzy-code",
	"dist",
);
const packageRoot = join(__dirname, "..", "resources", "fuzzy-code");
const dest = join(packageRoot, "dist");

(async () => {
	await mkdir(dest, { recursive: true });
	await cp(distDir, dest, { recursive: true, force: true });
	await writeFile(join(packageRoot, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
	console.log(`Copied @fuzzyos/fuzzy-code dist → resources/fuzzy-code/dist/`);
})();
