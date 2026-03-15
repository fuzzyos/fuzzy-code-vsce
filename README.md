# Fuzzy Code for VS Code

Harness the power of [Fuzzy Code](https://github.com/fuzzyos/fuzzyos) without leaving your IDE. This extension embeds the Fuzzy CLI directly into VS Code with a native chat interface.

## Features

- **Sidebar panel** — Chat with Fuzzy directly in the VS Code activity bar sidebar
- **Editor tabs** — Open Fuzzy as a full editor tab (multiple tabs supported, each with its own session)
- **Terminal sessions** — Launch Fuzzy in an integrated terminal for full TUI access
- **Native dialogs** — Confirmations, quick picks, and input boxes use VS Code's native UI
- **Bundled CLI** — No separate install required; the Fuzzy CLI is bundled inside the extension

## Usage

### Sidebar

Click the **Fuzzy Code icon** in the Activity Bar to open the sidebar panel.

### Editor Tab

| Command                              | Description                                          |
| ------------------------------------ | ---------------------------------------------------- |
| `Fuzzy Code: Open as Tab`            | Open a new Fuzzy Code editor tab                     |
| `Fuzzy Code: Focus Sidebar`          | Focus the Fuzzy sidebar panel                        |
| `Fuzzy Code: Open Fuzzy in Terminal` | Open Fuzzy in an integrated terminal                 |
| `Fuzzy Code: New Session`            | Start a new terminal session (`fuzzy --new`)         |
| `Fuzzy Code: Resume Session`         | Resume a previous terminal session (`fuzzy --resume`)|

The **New Fuzzy Tab** button (Fuzzy icon) is always visible in the editor tab bar for quick access.

Each tab runs an independent session — open as many as you need.

### Chat Input

- **Enter** — Send message
- **Shift+Enter** — Insert newline
- The send button (↑) switches to an abort button (⏹) while Fuzzy is responding

## Requirements

No external install needed — the bundled CLI is used automatically. To use a custom build instead, configure `fuzzy-code.executablePath`.

## Extension Settings

| Setting                      | Default      | Description                                                                  |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `fuzzy-code.executablePath`  | *(bundled)*  | Path to a custom `fuzzy` CLI executable. Leave empty to use the bundled CLI. |

## License

MIT
