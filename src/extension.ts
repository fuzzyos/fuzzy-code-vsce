import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { FuzzyPanel } from "./fuzzyPanel";
import { FuzzyTab } from "./fuzzyTab";

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
	const bundledCli = context.asAbsolutePath(path.join("resources", "fuzzy-code", "cli.mjs"));
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
	const workspaceFolder = getWorkspaceFolder();

	// Set NODE_PATH so user extensions can resolve dependencies
	// from the workspace node_modules (e.g. @sinclair/typebox)
	const nodePaths = [workspaceFolder ? path.join(workspaceFolder, "node_modules") : undefined, process.env.NODE_PATH]
		.filter(Boolean)
		.join(path.delimiter);

	fuzzyTerminal = vscode.window.createTerminal({
		name: "Fuzzy Code",
		cwd: workspaceFolder,
		shellPath,
		shellArgs: [...shellArgs, ...args],
		env: { NODE_PATH: nodePaths },
	});

	fuzzyTerminal.show();
	return fuzzyTerminal;
}

export function activate(context: vscode.ExtensionContext) {
	// Register the sidebar webview panel provider
	const fuzzyPanel = new FuzzyPanel(context);
	const fuzzyTabs = new Set<FuzzyTab>();

	const initialEditor = vscode.window.activeTextEditor;
	if (initialEditor?.document.uri.scheme === "file") {
		fuzzyPanel.setActiveFile(initialEditor.document.uri.fsPath);
	}

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(FuzzyPanel.viewType, fuzzyPanel, {
			webviewOptions: { retainContextWhenHidden: true },
		}),

		vscode.commands.registerCommand("fuzzy-code.openTab", () => {
			const tab = FuzzyTab.open(context);
			const activeFilePath =
				vscode.window.activeTextEditor?.document.uri.scheme === "file"
					? vscode.window.activeTextEditor.document.uri.fsPath
					: null;
			tab.setActiveFile(activeFilePath);
			fuzzyTabs.add(tab);
			tab.onDispose(() => fuzzyTabs.delete(tab));
		}),

		vscode.commands.registerCommand("fuzzy-code.focusSidebar", () => {
			vscode.commands.executeCommand(`${FuzzyPanel.viewType}.focus`);
		}),

		vscode.commands.registerCommand("fuzzy-code.openTuiTab", () => {
			const { shellPath, shellArgs } = getFuzzyExecutable(context);
			const workspaceFolder = getWorkspaceFolder();
			const nodePaths = [
				workspaceFolder ? path.join(workspaceFolder, "node_modules") : undefined,
				process.env.NODE_PATH,
			]
				.filter(Boolean)
				.join(path.delimiter);
			const terminal = vscode.window.createTerminal({
				name: "Fuzzy Code",
				cwd: workspaceFolder,
				shellPath,
				shellArgs,
				env: { NODE_PATH: nodePaths },
				location: vscode.TerminalLocation.Editor,
				isTransient: false,
			});
			terminal.show();
		}),

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

		vscode.window.onDidChangeActiveTextEditor((editor) => {
			// When a webview (e.g. the Fuzzy tab itself) gains focus, VS Code fires this
			// event with editor=undefined. Skip that case so the active file indicator
			// is not cleared just because the user switched to the Fuzzy panel.
			if (editor === undefined) return;
			const filePath = editor.document.uri.scheme === "file" ? editor.document.uri.fsPath : null;
			fuzzyPanel.setActiveFile(filePath);
			for (const tab of fuzzyTabs) tab.setActiveFile(filePath);
		}),

		vscode.window.onDidChangeTextEditorSelection((event) => {
			const editor = event.textEditor;
			if (editor.document.uri.scheme !== "file") return;
			const sel = editor.selection;
			const selection = sel.isEmpty
				? null
				: {
						text: editor.document.getText(sel),
						startLine: sel.start.line + 1,
						endLine: sel.end.line + 1,
					};
			fuzzyPanel.setSelection(selection);
			for (const tab of fuzzyTabs) tab.setSelection(selection);
		}),
	);
}

export function deactivate() {
	fuzzyTerminal?.dispose();
}
