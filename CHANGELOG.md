# Changelog

All notable changes to `@customergpt/cli` are documented here. This project follows [Semantic Versioning](https://semver.org).

## 0.4.0

Readable output for people, unchanged JSON for scripts.

### Added

- Tables and summaries in an interactive terminal: lists show a table with paging, `messages send` prints the answer, `installation snippet` prints the snippet, `doctor` shows a checklist. Colors respect `NO_COLOR` and `FORCE_COLOR`.
- `--json` on every command, and `CUSTOMERGPT_OUTPUT=json|human` to force a format.
- Errors in a terminal print the message, the error code and a `→` next step; a timed-out `--wait` shows the `jobs get` command to resume.
- "Did you mean" suggestions for mistyped commands (`chatbts list`) and options (`--limt`), with `UNKNOWN_COMMAND` and `UNKNOWN_OPTION` error codes.
- `customergpt completion bash|zsh` for commands, subcommands and per-command flags.
- `leads list --chatbot <id>` and `conversations list --leads-only`.
- `login --read-only` requests only the `agents:read` scope.

### Unchanged

- When stdout is not a terminal (pipes, CI, AI agents and MCP hosts), output is the same JSON envelope as 0.3.x. `call`, `actions` and `agent-guide` always print JSON.
