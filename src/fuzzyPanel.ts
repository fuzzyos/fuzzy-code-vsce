import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export class FuzzyPanel implements vscode.WebviewViewProvider {
	public static readonly viewType = "fuzzy-code.sidebar";
	private _view?: vscode.WebviewView;
	private _rpcProcess?: child_process.ChildProcess;
	private _disposed = false;
	private _buffer = "";

	constructor(private readonly _context: vscode.ExtensionContext) {}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._context.extensionUri],
		};
		webviewView.webview.html = this._getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(this._onWebviewMessage.bind(this));
		webviewView.onDidDispose(() => this._dispose());
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

		const workspaceFolders = vscode.workspace.workspaceFolders;
		const cwd = workspaceFolders?.[0]?.uri.fsPath ?? process.env.HOME;

		const workspaceNodeModules = cwd ? path.join(cwd, "node_modules") : undefined;
		const nodePath = [workspaceNodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);

		this._rpcProcess = child_process.spawn(shellPath, [...shellArgs, "--mode", "rpc"], {
			cwd,
			env: { ...process.env, NODE_PATH: nodePath },
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Use raw data events and manual LF splitting — mirrors the JSONL spec in jsonl.ts
		this._rpcProcess.stdout?.on("data", (chunk: Buffer) => {
			this._buffer += chunk.toString("utf8");
			while (true) {
				const idx = this._buffer.indexOf("\n");
				if (idx === -1) break;
				const line = this._buffer.slice(0, idx).replace(/\r$/, "");
				this._buffer = this._buffer.slice(idx + 1);
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					this._handleRpcEvent(msg);
				} catch {
					// Ignore malformed JSON
				}
			}
		});

		this._rpcProcess.stderr?.on("data", (data: Buffer) => {
			this._post({ type: "stderr", text: data.toString() });
		});

		this._rpcProcess.on("exit", (code) => {
			if (!this._disposed) {
				this._post({ type: "process_exit", code });
			}
		});

		// Request initial state and history after a short boot delay
		setTimeout(() => {
			this._writeRpc({ type: "get_state" });
			this._writeRpc({ type: "get_messages" });
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
				const result = await vscode.window.showInputBox({
					title: req.title,
					placeHolder: req.placeholder,
				});
				if (result === undefined) {
					this._writeRpc({ type: "extension_ui_response", id, cancelled: true });
				} else {
					this._writeRpc({ type: "extension_ui_response", id, value: result });
				}
				return;
			}
			if (req.method === "editor") {
				// Open an untitled document pre-filled with content; user submits via save
				const doc = await vscode.workspace.openTextDocument({
					content: req.prefill ?? "",
					language: "markdown",
				});
				await vscode.window.showTextDocument(doc);
				// We can't easily wait for user to "submit" — resolve with prefill
				this._writeRpc({ type: "extension_ui_response", id, value: req.prefill ?? "" });
				return;
			}
			if (req.method === "setTitle") {
				if (this._view) this._view.title = req.title;
				return;
			}
			if (req.method === "set_editor_text") {
				const doc = await vscode.workspace.openTextDocument({ content: req.text });
				await vscode.window.showTextDocument(doc);
				return;
			}
			// setStatus / setWidget — forward to webview for display
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
		this._view?.webview.postMessage(msg);
	}

	private _onWebviewMessage(msg: any) {
		if (msg.type === "rpc_command") {
			this._writeRpc(msg.command);
		} else if (msg.type === "restart") {
			this._rpcProcess?.kill();
			this._rpcProcess = undefined;
			this._buffer = "";
			setTimeout(() => this._spawnRpc(), 500);
		} else if (msg.type === "open_tab") {
			vscode.commands.executeCommand("fuzzy-code.openTab");
		}
	}

	private _getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, "dist", "webview.js"));
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

	private _dispose() {
		this._disposed = true;
		this._rpcProcess?.kill();
		this._rpcProcess = undefined;
	}
}
