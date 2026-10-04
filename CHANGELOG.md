# Changelog

All notable changes to `@customergpt/cli` are documented here. This project follows [Semantic Versioning](https://semver.org).

## Unreleased

Agent skill, waiting for all training of a bot, custom responses, conversation management, behaviour settings, team and API keys, request IDs.

### Added

- `knowledge responses list|add|update|delete`: fixed answers to specific questions. An exact match (ignoring case and punctuation) is answered verbatim; similar wording gets the answer as top-priority context. Requires a backend with custom responses.
- `knowledge wait --chatbot <id> [--timeout <seconds>]` blocks until nothing is training for the bot, with progress on stderr unless `--quiet`. It exits nonzero with `TRAINING_FAILED` and `training.failed` if training seen during the wait failed, and with `WAIT_TIMEOUT`, the sources still training and a resume command on timeout. `knowledge status --chatbot <id>` shows what is training now and failures from the last 24 hours. Both require a backend with the `training_status` action.
- The library exports `waitForTraining(chatbotId, options)`, also available as `createClient().waitForTraining`.
- `skills/customergpt-cli/SKILL.md` teaches AI agents to build a support bot with the CLI: install and `doctor`, anonymous onboarding or a logged-in account, create → train with `--wait` → test → install, JSON output and exit codes, safety rules and troubleshooting by error code. It ships in the npm package and is linked from the README.
- `agent-guide` returns `skill.url` (https://api.customergpt.ai/agents/customergpt-cli-skill.md, served by a backend with the skill route) and `skill.file`, the path of the packaged copy.

## 0.8.0

Train from documents.

### Added

- `knowledge files add <path>` trains on a `.pdf`, `.docx`, `.md`, `.txt` or `.csv` file up to 10 MB. The type and size are checked before upload; the server extracts the text. Requires a backend with document upload support.

## 0.7.0

Train from link lists and sitemaps.

### Added

- `knowledge links add <url> [url…]` trains on exactly the listed pages (up to 20) without following their links.
- `knowledge sitemap add <sitemap-url>` trains on pages listed in a `sitemap.xml` on the same site, following a sitemap index; `--max-pages` caps it.
- `knowledge documents resync` repeats a link list or sitemap the way it was added. Requires a backend with link-list and sitemap support.

## 0.6.0

Delete chatbots.

### Added

- `chatbots delete <id>` permanently deletes a chatbot with its knowledge, conversations and leads. `--dry-run` shows the bot name and how many sources and conversations would be removed; `--yes` deletes. Deletion is refused while the bot is training. Requires a backend with the `chatbots_delete` action.

## 0.5.0

Lighter install, built on the SDK.

### Added

- `customergpt dashboard` opens the dashboard in your browser; `--print` (or a non-terminal) only prints the URL. `CUSTOMERGPT_DASHBOARD_URL` overrides it.
- Every request sends `X-CustomerGPT-Client: cli/<version>`, or `mcp/<version>` from `customergpt mcp`, so the server can tell client versions apart. It never contains credentials.
- `support@customergpt.ai` in the README and package metadata.

### Changed

- `customergpt mcp` uses a built-in MCP stdio server instead of `@modelcontextprotocol/sdk`. A global install drops from about 160 packages to 2 (`@customergpt/cli` and `@customergpt/sdk`). Tools, arguments and results are unchanged; protocol versions 2024-11-05 through 2025-11-25 are supported.
- API requests go through [`@customergpt/sdk`](https://www.npmjs.com/package/@customergpt/sdk). Errors, hints, `--debug` tracing and the library exports are unchanged. Network failures and request timeouts now report `NETWORK_ERROR` and `TIMEOUT` codes with a hint.
- Action names given to `call` must use lowercase letters and underscores, as every server action does.

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
