#!/usr/bin/env node
// Copies the @fuzzyos/fuzzy-code dist into resources/fuzzy-code/
// so it can be bundled into the VSIX and used without a global install.

const { cp, mkdir } = require("fs/promises");
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
const dest = join(__dirname, "..", "resources", "fuzzy-code");

(async () => {
	await mkdir(dest, { recursive: true });
	await cp(distDir, dest, { recursive: true, force: true });
	console.log(`Copied @fuzzyos/fuzzy-code dist → resources/fuzzy-code/`);
})();
