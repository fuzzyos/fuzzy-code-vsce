import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export class FuzzyTab {
	private static _count = 0;

	private _panel: vscode.WebviewPanel;
	private _rpcProcess?: child_process.ChildProcess;
	private _buffer = "";
	private _disposed = false;
	private _activeFile: string | null = null;
	private _activeSelection: { text: string; startLine: number; endLine: number } | null = null;
	private _onDispose?: () => void;

	static open(context: vscode.ExtensionContext): FuzzyTab {
		return new FuzzyTab(context);
	}

	private constructor(private readonly _context: vscode.ExtensionContext) {
		const n = ++FuzzyTab._count;
		const title = n === 1 ? "Fuzzy Code" : `Fuzzy Code ${n}`;
		this._panel = vscode.window.createWebviewPanel("fuzzy-code.tab", title, vscode.ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [_context.extensionUri],
		});
		this._panel.iconPath = {
			light: vscode.Uri.joinPath(_context.extensionUri, "resources", "images", "icon_light.svg"),
			dark: vscode.Uri.joinPath(_context.extensionUri, "resources", "images", "icon_dark.svg"),
		};
		this._panel.webview.html = this._getHtml();
		this._panel.webview.onDidReceiveMessage(this._onWebviewMessage.bind(this));
		this._panel.onDidDispose(() => {
			this._disposed = true;
			this._rpcProcess?.kill();
			this._rpcProcess = undefined;
			this._onDispose?.();
		});
		this._spawnRpc();
	}

	private _findNodeBinary(): string {
		const home = process.env.HOME ?? "";
		const nvmDir = path.join(home, ".nvm", "versions", "node");
		if (fs.existsSync(nvmDir)) {
			const versions = fs.readdirSync(nvmDir).sort().reverse();
			for (const v of versions) {
				const bin = path.join(nvmDir, v, "bin", "node");
				if (fs.existsSync(bin)) return bin;
			}
		}
		for (const p of ["/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node"]) {
			if (fs.existsSync(p)) return p;
		}
		return "node";
	}

	private _spawnRpc() {
		this._buffer = "";
		const configured = vscode.workspace.getConfiguration("fuzzy-code").get<string>("executablePath");
		let shellPath: string;
		let shellArgs: string[];
		if (configured) {
			shellPath = configured;
			shellArgs = [];
		} else {
			const bundledCli = this._context.asAbsolutePath(path.join("resources", "fuzzy-code", "cli.mjs"));
			if (fs.existsSync(bundledCli)) {
				shellPath = this._findNodeBinary();
				shellArgs = [bundledCli];
			} else {
				shellPath = "fuzzy";
				shellArgs = [];
			}
		}

		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME;
		const nodePath = [cwd ? path.join(cwd, "node_modules") : undefined, process.env.NODE_PATH]
			.filter(Boolean)
			.join(path.delimiter);

		this._rpcProcess = child_process.spawn(shellPath, [...shellArgs, "--mode", "rpc"], {
			cwd,
			env: { ...process.env, NODE_PATH: nodePath },
			stdio: ["pipe", "pipe", "pipe"],
		});

		this._rpcProcess.stdout?.on("data", (chunk: Buffer) => {
			this._buffer += chunk.toString("utf8");
			while (true) {
				const idx = this._buffer.indexOf("\n");
				if (idx === -1) break;
				const line = this._buffer.slice(0, idx).replace(/\r$/, "");
				this._buffer = this._buffer.slice(idx + 1);
				if (!line.trim()) continue;
				try {
					this._handleRpcEvent(JSON.parse(line));
				} catch {}
			}
		});

		this._rpcProcess.stderr?.on("data", (data: Buffer) => {
			this._post({ type: "stderr", text: data.toString() });
		});

		this._rpcProcess.on("exit", (code) => {
			if (!this._disposed) this._post({ type: "process_exit", code });
		});

		setTimeout(() => {
			this._writeRpc({ type: "get_state" });
			this._writeRpc({ type: "get_messages" });
			this._post({ type: "active_file", path: this._activeFile });
		}, 400);
	}

	private _handleRpcEvent(msg: any) {
		if (msg.type === "extension_ui_request") {
			void this._handleExtensionUI(msg);
			return;
		}
		this._post(msg);
	}

	private async _handleExtensionUI(req: any) {
		const id: string = req.id;
		try {
			if (req.method === "notify") {
				const fn =
					req.notifyType === "error"
						? vscode.window.showErrorMessage
						: req.notifyType === "warning"
							? vscode.window.showWarningMessage
							: vscode.window.showInformationMessage;
				void fn(req.message);
				return;
			}
			if (req.method === "confirm") {
				const result = await vscode.window.showInformationMessage(
					req.message ?? req.title,
					{ modal: true },
					"Yes",
					"No",
				);
				this._writeRpc({ type: "extension_ui_response", id, confirmed: result === "Yes" });
				return;
			}
			if (req.method === "select") {
				const result = await vscode.window.showQuickPick(req.options as string[], { title: req.title });
				if (result === undefined) {
					this._writeRpc({ type: "extension_ui_response", id, cancelled: true });
				} else {
					this._writeRpc({ type: "extension_ui_response", id, value: result });
				}
				return;
			}
			if (req.method === "input") {
				const result = await vscode.window.showInputBox({ title: req.title, placeHolder: req.placeholder });
				if (result === undefined) {
					this._writeRpc({ type: "extension_ui_response", id, cancelled: true });
				} else {
					this._writeRpc({ type: "extension_ui_response", id, value: result });
				}
				return;
			}
			if (req.method === "editor") {
				const doc = await vscode.workspace.openTextDocument({ content: req.prefill ?? "", language: "markdown" });
				await vscode.window.showTextDocument(doc);
				this._writeRpc({ type: "extension_ui_response", id, value: req.prefill ?? "" });
				return;
			}
			if (req.method === "setTitle") {
				this._panel.title = req.title;
				return;
			}
			if (req.method === "set_editor_text") {
				const doc = await vscode.workspace.openTextDocument({ content: req.text });
				await vscode.window.showTextDocument(doc);
				return;
			}
			this._post(req);
		} catch {
			this._writeRpc({ type: "extension_ui_response", id, cancelled: true });
		}
	}

	private _writeRpc(cmd: object) {
		if (this._rpcProcess?.stdin?.writable) {
			this._rpcProcess.stdin.write(`${JSON.stringify(cmd)}\n`);
		}
	}

	private _post(msg: object) {
		if (!this._disposed) this._panel.webview.postMessage(msg);
	}

	onDispose(cb: () => void): void {
		this._onDispose = cb;
	}

	setActiveFile(path: string | null): void {
		this._activeFile = path;
		this._activeSelection = null;
		this._post({ type: "active_file", path });
	}

	setSelection(selection: { text: string; startLine: number; endLine: number } | null): void {
		this._activeSelection = selection;
		this._post({ type: "active_selection", startLine: selection?.startLine ?? null, endLine: selection?.endLine ?? null });
	}

	private _buildActiveFileTag(): string {
		if (!this._activeFile) return "";
		try {
			if (this._activeSelection?.text.trim()) {
				const { text, startLine, endLine } = this._activeSelection;
				return `<open_file path="${this._activeFile}" start_line="${startLine}" end_line="${endLine}">\n${text}\n</open_file>\n\n`;
			}
			const content = fs.readFileSync(this._activeFile, "utf-8");
			return `<open_file path="${this._activeFile}">\n${content}\n</open_file>\n\n`;
		} catch {
			return "";
		}
	}

	private _onWebviewMessage(msg: any) {
		if (msg.type === "rpc_command") {
			const cmd = msg.command;
			if (cmd.type === "prompt" && typeof cmd.message === "string") {
				this._writeRpc({ ...cmd, message: this._buildActiveFileTag() + cmd.message });
			} else {
				this._writeRpc(cmd);
			}
		} else if (msg.type === "restart") {
			this._rpcProcess?.kill();
			this._rpcProcess = undefined;
			this._buffer = "";
			setTimeout(() => this._spawnRpc(), 500);
		}
	}

	private _getHtml(): string {
		const scriptUri = this._panel.webview.asWebviewUri(
			vscode.Uri.joinPath(this._context.extensionUri, "dist", "webview.js"),
		);
		const nonce = crypto.randomUUID().replace(/-/g, "");
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fuzzy Code</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
