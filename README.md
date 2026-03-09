# Fuzzy Code for VS Code

Harness the power of [Fuzzy Code](https://github.com/fuzzyos/fuzzyos) without leaving your IDE. This extension integrates the Fuzzy CLI directly into VS Code as a terminal session.

## Features

- **Open Fuzzy in Terminal** — Launch a Fuzzy Code terminal in your current workspace
- **New Session** — Start a fresh Fuzzy Code session (`fuzzy --new`)
- **Resume Session** — Continue a previous Fuzzy Code session (`fuzzy --resume`)

The extension reuses an existing terminal when possible, so you won't end up with duplicate Fuzzy terminals open.

## Requirements

The `fuzzy` CLI must be installed and available on your `PATH`, or you can configure a custom path (see [Extension Settings](#extension-settings)).

## Usage

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for:

| Command | Description |
|---|---|
| `Fuzzy Code: Open Fuzzy in Terminal` | Open Fuzzy in an integrated terminal |
| `Fuzzy Code: New Session` | Start a new Fuzzy Code session |
| `Fuzzy Code: Resume Session` | Resume the most recent session |

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `fuzzy-code.executablePath` | `fuzzy` | Path to the `fuzzy` CLI executable |

If `fuzzy` is not on your `PATH`, set this to the full path of the binary, e.g. `/usr/local/bin/fuzzy`.

## License

MIT
