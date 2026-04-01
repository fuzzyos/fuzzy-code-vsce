# Changelog

## [Unreleased]

### Fixed

- Active file indicator cleared when Fuzzy Code Tab gains focus; `onDidChangeActiveTextEditor` now ignores `undefined` (webview activation) so the last known file persists while the Fuzzy panel is focused
