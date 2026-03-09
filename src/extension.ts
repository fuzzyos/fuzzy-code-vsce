import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

let fuzzyTerminal: vscode.Terminal | undefined;

function getWorkspaceFolder(): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (folders && folders.length > 0) {
		return folders[0].uri.fsPath;
	}
	return undefined;
}

function findNodeBinary(): string {
	// Scan nvm versions (newest first)
	const home = process.env.HOME ?? "";
	const nvmDir = path.join(home, ".nvm", "versions", "node");
	if (fs.existsSync(nvmDir)) {
		const versions = fs.readdirSync(nvmDir).sort().reverse();
		for (const version of versions) {
			const bin = path.join(nvmDir, version, "bin", "node");
			if (fs.existsSync(bin)) return bin;
		}
	}
	// Common system paths
	for (const p of ["/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node"]) {
		if (fs.existsSync(p)) return p;
	}
	return "node";
}

function getFuzzyExecutable(context: vscode.ExtensionContext): {
	shellPath: string;
	shellArgs: string[];
} {
	// User-configured path takes precedence
	const configured = vscode.workspace.getConfiguration("fuzzy-code").get<string>("executablePath");
	if (configured) {
		return { shellPath: configured, shellArgs: [] };
	}

	// Use bundled CLI with a real node binary (process.execPath is Electron in VS Code)
	const bundledCli = context.asAbsolutePath(path.join("resources", "fuzzy-code", "dist", "cli.js"));
	if (fs.existsSync(bundledCli)) {
		return { shellPath: findNodeBinary(), shellArgs: [bundledCli] };
	}

	// Fall back to fuzzy on PATH
	return { shellPath: "fuzzy", shellArgs: [] };
}

function openFuzzyTerminal(context: vscode.ExtensionContext, args: string[] = []): vscode.Terminal {
	// Reuse existing terminal only when opening without specific args (no --new/--resume)
	if (args.length === 0 && fuzzyTerminal && fuzzyTerminal.exitStatus === undefined) {
		fuzzyTerminal.show();
		return fuzzyTerminal;
	}

	const { shellPath, shellArgs } = getFuzzyExecutable(context);

	fuzzyTerminal = vscode.window.createTerminal({
		name: "Fuzzy Code",
		cwd: getWorkspaceFolder(),
		shellPath,
		shellArgs: [...shellArgs, ...args],
	});

	fuzzyTerminal.show();
	return fuzzyTerminal;
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand("fuzzy-code.openInTerminal", () => {
			openFuzzyTerminal(context);
		}),

		vscode.commands.registerCommand("fuzzy-code.newSession", () => {
			openFuzzyTerminal(context, ["--new"]);
		}),

		vscode.commands.registerCommand("fuzzy-code.resumeSession", () => {
			openFuzzyTerminal(context, ["--resume"]);
		}),

		// Clean up terminal reference on close
		vscode.window.onDidCloseTerminal((terminal) => {
			if (terminal === fuzzyTerminal) {
				fuzzyTerminal = undefined;
			}
		}),
	);
}

export function deactivate() {
	fuzzyTerminal?.dispose();
}
