// Webview script — bundled to dist/webview.js by esbuild (iife, browser platform).
// acquireVsCodeApi() is called exactly once and stored in `vscode`.

declare function acquireVsCodeApi(): {
	postMessage(msg: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
};

// ────────────────────────────────────────────────────────────────────────────
// VS Code API
// ────────────────────────────────────────────────────────────────────────────

const vscode = acquireVsCodeApi();

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Strip ANSI SGR escape sequences. */
function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Escape HTML special characters. */
function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Very lightweight markdown renderer.
 * Handles fenced code blocks, inline code, bold, italic and plain newlines.
 */
function renderMarkdown(raw: string): string {
	const clean = stripAnsi(raw);
	const parts = clean.split(/(```[\s\S]*?```)/g);
	const rendered = parts
		.map((part, i) => {
			if (i % 2 === 1) {
				// Fenced code block
				const inner = part.slice(3, -3);
				const firstNewline = inner.indexOf("\n");
				const lang = firstNewline === -1 ? "" : escHtml(inner.slice(0, firstNewline).trim());
				const code = firstNewline === -1 ? escHtml(inner) : escHtml(inner.slice(firstNewline + 1));
				const langAttr = lang ? ` data-lang="${lang}"` : "";
				return `<pre class="code-block"${langAttr}><code>${code}</code></pre>`;
			}
			// Inline markdown
			return escHtml(part)
				.replace(/`([^`]+)`/g, "<code>$1</code>")
				.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
				.replace(/\*([^*]+)\*/g, "<em>$1</em>")
				.replace(/\n/g, "<br>");
		})
		.join("");
	return rendered;
}

/** Extract plain text from an AgentMessage content array or string. */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block: any) => {
			if (block.type === "text") return block.text ?? "";
			if (block.type === "thinking") return `<thinking>${block.thinking ?? ""}</thinking>`;
			if (block.type === "toolCall") return `[Tool: ${block.name ?? ""}(${JSON.stringify(block.input ?? {})})]`;
			return "";
		})
		.join("");
}

/** Derive a display role label and CSS class from an AgentMessage. */
function roleInfo(msg: any): { label: string; cls: string } {
	const role = msg.role ?? "";
	if (role === "user") return { label: "You", cls: "msg-user" };
	if (role === "assistant") return { label: "Fuzzy", cls: "msg-assistant" };
	if (role === "toolResult") return { label: "Tool result", cls: "msg-tool" };
	return { label: role, cls: "msg-other" };
}

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────

interface DisplayMessage {
	id: string; // synthetic id for DOM lookup
	role: string;
	html: string;
	raw: string;
	collapsed: boolean;
}

const state: {
	sessionName: string;
	modelLabel: string;
	isStreaming: boolean;
	messages: DisplayMessage[];
	streamMsgId: string | null;
} = {
	sessionName: "Fuzzy Code",
	modelLabel: "",
	isStreaming: false,
	messages: [],
	streamMsgId: null,
};

let msgCounter = 0;
function nextId(): string {
	return `m${++msgCounter}`;
}

// ────────────────────────────────────────────────────────────────────────────
// DOM
// ────────────────────────────────────────────────────────────────────────────

function injectStyles() {
	const style = document.createElement("style");
	style.textContent = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--vscode-font-family, system-ui, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  color: var(--vscode-editor-foreground);
  overflow: hidden;
}

#app {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

#toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background));
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border, transparent));
  flex-shrink: 0;
}

#session-name {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-sideBarTitle-foreground, var(--vscode-editor-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}

#model-label {
  font-size: 10px;
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  max-width: 90px;
  text-overflow: ellipsis;
}

.toolbar-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--vscode-icon-foreground, var(--vscode-editor-foreground));
  opacity: 0.7;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
}
.toolbar-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
.toolbar-btn:disabled { opacity: 0.3; cursor: default; }

#error-bar {
  background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
  border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
  color: var(--vscode-inputValidation-errorForeground, #f48771);
  padding: 4px 8px;
  font-size: 11px;
  display: none;
  word-break: break-word;
}
#error-bar.visible { display: block; }

#messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.msg-row {
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.msg-label {
  font-size: 10px;
  font-weight: 600;
  opacity: 0.55;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.msg-user .msg-label { color: var(--vscode-terminal-ansiBlue); }
.msg-assistant .msg-label { color: var(--vscode-terminal-ansiGreen); }
.msg-tool .msg-label { color: var(--vscode-terminal-ansiYellow); opacity: 0.5; }

.msg-body {
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}

.msg-body br { display: block; content: ""; }

.msg-tool .msg-body {
  font-size: 11px;
  opacity: 0.65;
}

.msg-tool.collapsed .msg-body { display: none; }
.msg-tool .msg-label { cursor: pointer; user-select: none; }
.msg-tool .msg-label::before { content: "▶ "; font-size: 9px; }
.msg-tool.collapsed .msg-label::before { content: "▶ "; }
.msg-tool:not(.collapsed) .msg-label::before { content: "▼ "; }

pre.code-block {
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
  border: 1px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,0.2));
  border-radius: 4px;
  padding: 8px 10px;
  overflow-x: auto;
  white-space: pre;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
  margin: 4px 0;
}

code {
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 12px;
}

pre.code-block code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}

.stream-cursor {
  display: inline-block;
  width: 8px;
  height: 1em;
  background: var(--vscode-editor-foreground);
  opacity: 0.7;
  margin-left: 1px;
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
}
@keyframes blink { 0%,100% { opacity: 0.7; } 50% { opacity: 0; } }

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--vscode-editor-foreground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  opacity: 0.6;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

#input-area {
  padding: 8px 12px 12px;
  flex-shrink: 0;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}

#active-file {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 4px 14px 0;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
#active-file.visible { display: flex; }

#input-card {
  border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35));
  border-radius: 12px;
  background: var(--vscode-input-background);
  display: flex;
  flex-direction: column;
  transition: border-color 0.1s;
}
#input-card:focus-within {
  border-color: var(--vscode-focusBorder);
}

#prompt-input {
  width: 100%;
  background: transparent;
  color: var(--vscode-input-foreground);
  border: none;
  padding: 12px 14px 6px;
  font-family: inherit;
  font-size: inherit;
  resize: none;
  min-height: 48px;
  max-height: 200px;
  outline: none;
  line-height: 1.5;
}

#input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 8px;
}

#input-hint {
  font-size: 10px;
  opacity: 0.4;
  padding-left: 4px;
}

#send-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 16px;
  line-height: 1;
}
#send-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
#send-btn:disabled { opacity: 0.3; cursor: default; }
#send-btn.abort {
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
  color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
}
#send-btn.abort:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
}

.action-btn {
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
  color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  white-space: nowrap;
}
.action-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3)); }
.action-btn:disabled { opacity: 0.4; cursor: default; }

#reconnect-bar {
  padding: 8px 12px;
  display: none;
  align-items: center;
  gap: 8px;
  background: var(--vscode-inputValidation-warningBackground, rgba(128,128,128,0.1));
  border-top: 1px solid var(--vscode-inputValidation-warningBorder, rgba(128,128,128,0.3));
  font-size: 12px;
}
#reconnect-bar.visible { display: flex; }

.msg-divider {
  border: none;
  border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
  margin: 2px 12px;
}

.status-badge {
  font-size: 10px;
  opacity: 0.5;
  padding: 0 4px;
}
`;
	document.head.appendChild(style);
}

// ────────────────────────────────────────────────────────────────────────────
// Build UI
// ────────────────────────────────────────────────────────────────────────────

let elToolbar: HTMLElement;
let elSessionName: HTMLSpanElement;
let elModelLabel: HTMLSpanElement;
let elNewBtn: HTMLButtonElement;
let elAbortBtn: HTMLButtonElement;
let elSpinner: HTMLSpanElement;
let elErrorBar: HTMLDivElement;
let elMessages: HTMLDivElement;
let elReconnectBar: HTMLDivElement;
let elPromptInput: HTMLTextAreaElement;
let elSubmitBtn: HTMLButtonElement;
let elActiveFile: HTMLDivElement;

function buildUI() {
	const app = document.getElementById("app")!;

	// Toolbar
	elToolbar = document.createElement("div");
	elToolbar.id = "toolbar";

	elSessionName = document.createElement("span");
	elSessionName.id = "session-name";
	elSessionName.textContent = "Fuzzy Code";

	elModelLabel = document.createElement("span");
	elModelLabel.id = "model-label";

	elSpinner = document.createElement("span");
	elSpinner.className = "spinner";
	elSpinner.style.display = "none";

	elNewBtn = document.createElement("button");
	elNewBtn.className = "toolbar-btn";
	elNewBtn.title = "New session";
	elNewBtn.textContent = "＋";
	elNewBtn.addEventListener("click", () => {
		sendRpc({ type: "new_session" });
	});

	elAbortBtn = document.createElement("button");
	elAbortBtn.className = "toolbar-btn";
	elAbortBtn.title = "Abort";
	elAbortBtn.textContent = "⏹";
	elAbortBtn.disabled = true;
	elAbortBtn.addEventListener("click", () => {
		sendRpc({ type: "abort" });
	});

	const elOpenTabBtn = document.createElement("button");
	elOpenTabBtn.className = "toolbar-btn";
	elOpenTabBtn.title = "Open as tab";
	elOpenTabBtn.innerHTML = "&#x29C9;"; // ⧉
	elOpenTabBtn.addEventListener("click", () => {
		vscode.postMessage({ type: "open_tab" });
	});

	elToolbar.append(elSessionName, elModelLabel, elSpinner, elNewBtn, elAbortBtn, elOpenTabBtn);

	// Error bar
	elErrorBar = document.createElement("div");
	elErrorBar.id = "error-bar";

	// Messages
	elMessages = document.createElement("div");
	elMessages.id = "messages";

	// Reconnect bar
	elReconnectBar = document.createElement("div");
	elReconnectBar.id = "reconnect-bar";
	const reconnectLabel = document.createElement("span");
	reconnectLabel.style.flex = "1";
	reconnectLabel.textContent = "Fuzzy process exited.";
	const reconnectBtn = document.createElement("button");
	reconnectBtn.className = "action-btn secondary";
	reconnectBtn.textContent = "Restart";
	reconnectBtn.addEventListener("click", () => {
		elReconnectBar.classList.remove("visible");
		vscode.postMessage({ type: "restart" });
	});
	elReconnectBar.append(reconnectLabel, reconnectBtn);

	// Input area
	const inputArea = document.createElement("div");
	inputArea.id = "input-area";

	const inputCard = document.createElement("div");
	inputCard.id = "input-card";

	elPromptInput = document.createElement("textarea");
	elPromptInput.id = "prompt-input";
	elPromptInput.placeholder = "Ask Fuzzy something…";
	elPromptInput.rows = 2;
	elPromptInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submitPrompt();
		}
	});
	elPromptInput.addEventListener("input", () => {
		elPromptInput.style.height = "auto";
		elPromptInput.style.height = `${Math.min(elPromptInput.scrollHeight, 200)}px`;
	});

	const inputFooter = document.createElement("div");
	inputFooter.id = "input-footer";

	const hint = document.createElement("span");
	hint.id = "input-hint";
	hint.textContent = "↵ send · ⇧↵ newline";

	elSubmitBtn = document.createElement("button");
	elSubmitBtn.id = "send-btn";
	elSubmitBtn.title = "Send";
	elSubmitBtn.innerHTML = "&#x2191;"; // ↑
	elSubmitBtn.addEventListener("click", () => {
		if (state.isStreaming) {
			sendRpc({ type: "abort" });
		} else {
			submitPrompt();
		}
	});

	elActiveFile = document.createElement("div");
	elActiveFile.id = "active-file";

	inputFooter.append(hint, elSubmitBtn);
	inputCard.append(elActiveFile, elPromptInput, inputFooter);
	inputArea.append(inputCard);

	app.append(elToolbar, elErrorBar, elMessages, elReconnectBar, inputArea);
}

// ────────────────────────────────────────────────────────────────────────────
// Render / update helpers
// ────────────────────────────────────────────────────────────────────────────

function updateToolbar() {
	elSessionName.textContent = state.sessionName || "Fuzzy Code";
	elModelLabel.textContent = state.modelLabel;
	elSpinner.style.display = state.isStreaming ? "inline-block" : "none";
	elAbortBtn.disabled = !state.isStreaming;
	if (state.isStreaming) {
		elSubmitBtn.innerHTML = "&#x23F9;"; // ⏹
		elSubmitBtn.title = "Abort";
		elSubmitBtn.classList.add("abort");
	} else {
		elSubmitBtn.innerHTML = "&#x2191;"; // ↑
		elSubmitBtn.title = "Send";
		elSubmitBtn.classList.remove("abort");
	}
}

function scrollToBottom() {
	elMessages.scrollTop = elMessages.scrollHeight;
}

function createMessageEl(dm: DisplayMessage): HTMLElement {
	const { label, cls } = roleInfo({ role: dm.role });

	const row = document.createElement("div");
	row.className = `msg-row ${cls}`;
	row.dataset.id = dm.id;
	if (dm.role === "toolResult" && dm.collapsed) row.classList.add("collapsed");

	const labelEl = document.createElement("div");
	labelEl.className = "msg-label";
	labelEl.textContent = label;

	// Tool messages are togglable
	if (dm.role === "toolResult") {
		labelEl.addEventListener("click", () => {
			row.classList.toggle("collapsed");
		});
	}

	const body = document.createElement("div");
	body.className = "msg-body";
	body.innerHTML = dm.html;

	row.append(labelEl, body);
	return row;
}

function appendMessage(dm: DisplayMessage) {
	state.messages.push(dm);
	const el = createMessageEl(dm);
	elMessages.appendChild(el);
	scrollToBottom();
}

function updateMessageEl(id: string, html: string, raw: string) {
	const el = elMessages.querySelector(`[data-id="${id}"]`);
	if (!el) return;
	const body = el.querySelector(".msg-body");
	if (body) body.innerHTML = html;
	const dm = state.messages.find((m) => m.id === id);
	if (dm) {
		dm.html = html;
		dm.raw = raw;
	}
}

function showError(text: string) {
	elErrorBar.textContent = text;
	elErrorBar.classList.add("visible");
}

function hideError() {
	elErrorBar.classList.remove("visible");
}

// ────────────────────────────────────────────────────────────────────────────
// RPC send
// ────────────────────────────────────────────────────────────────────────────

function sendRpc(command: object) {
	vscode.postMessage({ type: "rpc_command", command });
}

function submitPrompt() {
	const text = elPromptInput.value.trim();
	if (!text) return;
	elPromptInput.value = "";
	elPromptInput.style.height = "auto";
	hideError();
	sendRpc({ type: "prompt", message: text });
}

// ────────────────────────────────────────────────────────────────────────────
// Handle incoming RPC events
// ────────────────────────────────────────────────────────────────────────────

function agentMessageToDisplay(msg: any): DisplayMessage | null {
	const role: string = msg.role ?? "unknown";
	const raw = extractText(msg.content);
	if (!raw.trim()) return null;
	const isCollapsible = role === "toolResult";
	const html = renderMarkdown(raw);
	return {
		id: nextId(),
		role,
		html,
		raw,
		collapsed: isCollapsible,
	};
}

function handleMessage(event: MessageEvent) {
	const msg = event.data as any;
	if (!msg || !msg.type) return;

	switch (msg.type) {
		// ── State response ──────────────────────────────────────────────────
		case "response": {
			if (msg.command === "get_state" && msg.success && msg.data) {
				const d = msg.data;
				state.sessionName = d.sessionName ?? "Fuzzy Code";
				if (d.model) {
					state.modelLabel = d.model.name ?? d.model.id ?? "";
				}
				state.isStreaming = d.isStreaming ?? false;
				updateToolbar();
			}
			if (msg.command === "get_messages" && msg.success && msg.data) {
				// Replay history
				const messages: any[] = msg.data.messages ?? [];
				elMessages.innerHTML = "";
				state.messages = [];
				for (const m of messages) {
					const dm = agentMessageToDisplay(m);
					if (dm) appendMessage(dm);
				}
			}
			if (msg.command === "new_session" && msg.success) {
				// Clear on new session
				elMessages.innerHTML = "";
				state.messages = [];
				state.streamMsgId = null;
				state.sessionName = "Fuzzy Code";
				updateToolbar();
				sendRpc({ type: "get_state" });
			}
			break;
		}

		// ── Streaming lifecycle ─────────────────────────────────────────────
		case "agent_start": {
			state.isStreaming = true;
			state.streamMsgId = null;
			updateToolbar();
			break;
		}
		case "agent_end": {
			state.isStreaming = false;
			state.streamMsgId = null;
			// Remove streaming cursor from last message
			const lastCursor = elMessages.querySelector(".stream-cursor");
			if (lastCursor) lastCursor.remove();
			updateToolbar();
			// Refresh state
			sendRpc({ type: "get_state" });
			break;
		}

		// ── Message events ──────────────────────────────────────────────────
		case "message_start": {
			const m = msg.message;
			if (!m) break;
			const role: string = m.role ?? "unknown";
			// Skip toolResult here — we wait for message_end to have full content
			if (role === "toolResult") break;
			const raw = extractText(m.content);
			const html = role === "assistant" ? '<span class="stream-cursor"></span>' : renderMarkdown(raw);
			const dm: DisplayMessage = {
				id: nextId(),
				role,
				html,
				raw,
				collapsed: false,
			};
			appendMessage(dm);
			if (role === "assistant") {
				state.streamMsgId = dm.id;
			}
			break;
		}

		case "message_update": {
			// message_update carries the full current message state during streaming
			if (!state.streamMsgId) break;
			const m = msg.message;
			if (!m) break;
			const raw = extractText(m.content);
			const html = `${renderMarkdown(raw)}<span class="stream-cursor"></span>`;
			updateMessageEl(state.streamMsgId, html, raw);
			scrollToBottom();
			break;
		}

		case "message_end": {
			const m = msg.message;
			if (!m) break;
			const role: string = m.role ?? "unknown";
			const raw = extractText(m.content);
			const html = renderMarkdown(raw);

			if (role === "toolResult") {
				// Tool results: create new collapsed entry
				const dm: DisplayMessage = {
					id: nextId(),
					role,
					html,
					raw,
					collapsed: true,
				};
				appendMessage(dm);
			} else if (state.streamMsgId) {
				// Finalize the streaming assistant message
				updateMessageEl(state.streamMsgId, html, raw);
				state.streamMsgId = null;
				scrollToBottom();
			}
			break;
		}

		// ── Session name change ─────────────────────────────────────────────
		case "extension_ui_request": {
			if (msg.method === "setTitle") {
				state.sessionName = msg.title;
				elSessionName.textContent = msg.title;
			}
			break;
		}

		// ── Process died ────────────────────────────────────────────────────
		case "process_exit": {
			state.isStreaming = false;
			updateToolbar();
			elReconnectBar.classList.add("visible");
			break;
		}

		// ── Stderr forwarded from extension host ────────────────────────────
		case "stderr": {
			// Only show non-empty, non-whitespace stderr
			const text: string = (msg.text ?? "").trim();
			if (text) showError(`stderr: ${text}`);
			break;
		}
		case "active_file": {
			const filePath: string | null = msg.path ?? null;
			if (filePath) {
				const name = filePath.replace(/.*[/\\]/, "");
				elActiveFile.textContent = `📄 ${name}`;
				elActiveFile.title = filePath;
				elActiveFile.classList.add("visible");
			} else {
				elActiveFile.classList.remove("visible");
			}
			break;
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────────────────

injectStyles();
buildUI();
window.addEventListener("message", handleMessage);
