# CustomerGPT CLI

[![npm version](https://img.shields.io/npm/v/@customergpt/cli.svg)](https://www.npmjs.com/package/@customergpt/cli)
[![npm downloads](https://img.shields.io/npm/dm/@customergpt/cli.svg)](https://www.npmjs.com/package/@customergpt/cli)
[![Node.js](https://img.shields.io/node/v/@customergpt/cli.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/npm/l/@customergpt/cli.svg)](https://github.com/Xursand7777/customergpt-cli/blob/main/LICENSE)

The official command-line interface for **[CustomerGPT](https://customergpt.ai)**. Create a support bot, train it on your website, test its answers and get the code to install it on your site.

Use your own CustomerGPT account from the terminal, CI scripts or MCP-compatible AI assistants:

- **People** get readable tables, colors, typo suggestions and shell completion.
- **Scripts** get a stable JSON envelope whenever output is piped or `--json` is passed, plus exit codes and `--dry-run`.
- **AI agents** get `agent-guide`, an MCP server and `--wait`, so they never have to poll training.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Try without an account](#try-without-an-account)
- [Authentication](#authentication)
- [Profiles](#profiles)
- [Diagnostics](#diagnostics)
- [Commands](#commands)
- [Automation and JSON](#automation-and-json)
- [Shell completion](#shell-completion)
- [MCP](#mcp)
- [JavaScript and TypeScript](#javascript-and-typescript)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Development](#development)
- [Support](#support)
- [License](#license)

## Install

Requires **Node.js 20 or later**.

```bash
npm install -g @customergpt/cli
customergpt --version
```

To update, run `npm install -g @customergpt/cli@latest`.

## Quick start

### 1. Sign in

```bash
customergpt login
```

Your browser opens CustomerGPT. Sign in and approve the connection, then return to the terminal. Authenticated commands require a plan with API access. You can manage your account in the [CustomerGPT dashboard](https://dashboard.customergpt.ai).

### 2. Create a bot

```bash
customergpt chatbots create "Support Bot" --url https://example.com --yes
```

In a terminal the CLI prints a summary. With `--json` (or when piped) you get the full response, shortened here:

```json
{
  "ok": true,
  "data": {
    "id": "e8503caf-9761-4a69-a3bf-b677718d19cf",
    "name": "Support Bot",
    "websiteUrl": "https://example.com",
    "widgetId": "YOUR_WIDGET_ID"
  }
}
```

Copy **`data.id`** and replace `BOT_ID` in the following commands. Creating a bot does not train it yet.

### 3. Train it on your website

```bash
customergpt knowledge website add https://example.com --chatbot BOT_ID --yes --wait
```

The default crawl reads up to five same-origin pages. Use `--max-pages 20` for a larger crawl. Training is limited to 50,000 characters per job; this crawler does not execute JavaScript. Review returned warnings for skipped or truncated content.

### 4. Test an answer

```bash
customergpt messages send "What services do you offer?" --chatbot BOT_ID --yes
```

Returns the answer in `data.response`. This is a single-turn preview: it uses your message quota but does not create a customer conversation or send a message to a real visitor.

### 5. Install the widget

```bash
customergpt installation snippet --chatbot BOT_ID
```

Copy `data.snippet` into your website before `</body>`. It contains your public widget ID, never your API key:

```html
<script src="https://widget.customergpt.ai/embed.js" data-widget-id="YOUR_WIDGET_ID" defer></script>
```

## Try without an account

```bash
customergpt onboarding start https://example.com --yes --wait
```

Returns a temporary bot job, secret token and preview URL. Open the preview URL to ask questions and claim the bot into your account. Keep the token and URL private. Drafts expire after 24 hours and allow up to 20 preview messages; availability also depends on the server's daily onboarding limit.

```bash
customergpt onboarding status JOB_ID --token TEMPORARY_TOKEN
customergpt onboarding preview JOB_ID --token TEMPORARY_TOKEN --message "What do you offer?"
```

## Authentication

```bash
customergpt login
customergpt login --no-browser
customergpt login --read-only
customergpt whoami
customergpt logout
```

Browser login uses OAuth with PKCE and a local callback. `--no-browser` prints the URL instead of opening it; open it on the same computer as the CLI. `--read-only` requests only the `agents:read` scope, so the session can list and read but never change anything. `whoami` validates access and returns usage, not your email or profile details.

Your session is saved in `~/.config/customergpt/config.json`; access tokens refresh automatically. Protect this file and do not commit it. POSIX systems use owner-only file permissions.

For CI, provide your own API key via `CUSTOMERGPT_API_KEY`. You can also pipe a key to `customergpt login --token-stdin` to validate and save it without placing the value directly in command history.

`logout` revokes a saved OAuth session. For a saved API key it only clears the local copy; revoke the key in your dashboard if needed. Environment variables are not cleared by logout.

## Profiles

Keep separate accounts and servers without retyping API keys:

```bash
customergpt login --profile work
customergpt login --profile staging --api-base https://staging.example.com
customergpt profiles list
customergpt profiles use work
customergpt chatbots list --profile staging
customergpt logout --profile staging
```

Selection order: `--profile`, then `CUSTOMERGPT_PROFILE`, then the saved default. Login creates the selected profile; `profiles use` selects an existing one. The previous single-account config is preserved as `default` and migrated on the next config write. Profile listings show names and server origins, never tokens. Environment API keys still override saved profile credentials. Logout only clears the selected profile.

## Diagnostics

```bash
customergpt doctor
customergpt doctor --profile staging --debug
customergpt chatbots list --debug --timeout 20
customergpt knowledge website add https://example.com --chatbot BOT_ID --yes --wait --timeout 600 --quiet
```

`doctor` checks the local Node.js version, config, server action catalog, OAuth issuer/PKCE and authenticated account access. It returns JSON and exits nonzero if any check fails. It does not create bots or send AI messages; an expired OAuth session may refresh normally. It reports your installed CLI version, not whether a newer npm version exists.

`--debug` logs API method, origin/path, status and elapsed time to stderr. It never logs request headers, bodies, URL query parameters or tokens. `--quiet` suppresses job-start progress, while preserving errors and explicitly requested debug output.

`--timeout <seconds>` controls each agent API request and the total training wait (positive, up to 86400 seconds). Defaults are 180 seconds per API request and 900 seconds for training. For browser login it controls the approval wait; individual OAuth exchanges retain their 30-second network deadline. Timing out does not cancel server-side training.

## Commands

| Group | Available operations |
| --- | --- |
| Account | `login`, `logout`, `whoami`, `usage`, `profiles list`, `profiles use` |
| Diagnostics | `doctor` |
| Bots | `chatbots list`, `get`, `create`, `update` |
| Training | `knowledge website add`, `knowledge text add` |
| Sources | `knowledge documents list`, `resync`, `delete` |
| Preview | `messages send` |
| Website installation | `installation snippet` |
| Conversations | `conversations list` (`--mode`, `--leads-only`), `get`, `update` |
| Leads | `leads list` |
| Analytics | `analytics get` |
| Anonymous onboarding | `onboarding start`, `status`, `preview`, `claim` |
| Jobs | `jobs get` |
| AI assistants | `mcp`, `agent-guide` |
| Shell | `completion bash`, `completion zsh` |
| Advanced API | `actions`, `call` |

```bash
customergpt --help
customergpt knowledge --help
customergpt chatbots list
customergpt knowledge text add "We open at 9am." --chatbot BOT_ID --name Hours --yes
customergpt leads list --chatbot BOT_ID
customergpt conversations update CONVERSATION_ID --chatbot BOT_ID --status closed --yes
```

Typos get a suggestion: `customergpt chatbts list` answers *Did you mean "customergpt chatbots list"?*, and `--limt` suggests `--limit`.

Use `customergpt actions` for server-side input schemas. Named commands expose common options; `call` supports all fields in the action schema. Billing and team management are not currently supported by this CLI.

## Automation and JSON

In an interactive terminal, named commands print tables and summaries. Output is JSON when stdout is not a terminal (pipes, CI, AI agents), when you pass `--json`, or when `CUSTOMERGPT_OUTPUT=json` is set. `call`, `actions` and `agent-guide` always print JSON. With `call`, `--json` instead takes an input object:

```bash
customergpt chatbots list --json
customergpt call chatbots_list --json '{"limit":10}'
customergpt call sources_add --json-file source.json --yes --wait
```

Use `--json-file` when shell quoting is inconvenient. Example `source.json`:

```json
{"chatbotId":"BOT_ID","name":"Help center","url":"https://example.com/help","maxPages":10}
```

Replace `BOT_ID` with the UUID returned by bot creation.

- `--yes` confirms a change or a quota-consuming preview.
- `--dry-run` validates inputs and ownership without executing. It does not reserve quota or guarantee provider availability.
- `--wait` waits up to 15 minutes for training and fails if the job fails.
- Exit code **0** means success; failures use a nonzero exit code and write the error to stderr: JSON in JSON mode, a message with a `→` next step in a terminal.

Example error:

```json
{"ok":false,"error":{"code":"HTTP_401","message":"Invalid or expired OAuth access token","hint":"Run customergpt login or set CUSTOMERGPT_API_KEY."}}
```

Keep stdout for results and stderr for errors/progress. Training progress includes a resumable job handle; anonymous handles contain secrets, so avoid publishing these logs. An interrupted wait does not cancel server-side training. Inspect it with `customergpt jobs get JOB_ID` (add `--token` for an anonymous draft).

For AI assistants, `customergpt agent-guide` prints the workflow and command map. Authenticate with your own account, inspect the actions, and confirm changes before executing them.

## Shell completion

```bash
# zsh
source <(customergpt completion zsh)

# bash
source <(customergpt completion bash)
```

Add the line to `~/.zshrc` or `~/.bashrc` to keep it. Completion suggests commands, subcommands and each command's flags.

## MCP

Run `customergpt login` first, then add this configuration to a client that supports local stdio MCP servers:

```json
{
  "mcpServers": {
    "customergpt": {
      "command": "customergpt",
      "args": ["mcp"]
    }
  }
}
```

The client must be able to find the installed executable on its PATH. On Windows, some clients need `command: "cmd"` with `args: ["/c", "customergpt", "mcp"]` to launch the npm command shim.

The server uses the saved session. For CI, pass `CUSTOMERGPT_API_KEY` via the client's environment; do not commit real keys in configuration examples. Without credentials, only anonymous tools are advertised. Stdout is reserved for the MCP protocol.

Clients supporting remote MCP can connect to **https://api.customergpt.ai/api/mcp** and use OAuth instead. Actual tools are discovered from the deployed backend.

## JavaScript and TypeScript

```bash
npm install @customergpt/cli
```

```js
import { createClient } from '@customergpt/cli';

const customer = createClient({ key: process.env.CUSTOMERGPT_API_KEY });
const result = await customer.call('chatbots_list');
console.log(result.data);
```

ESM with TypeScript declarations. Public exports: `createClient`, `request`, `waitForJob`. Importing the package does not start the CLI or MCP server. The library uses the same configuration fallback as the CLI.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CUSTOMERGPT_API_URL` | Backend origin without `/api`; default `https://api.customergpt.ai` |
| `CUSTOMERGPT_API_KEY` | Credential override for scripts and CI |
| `CUSTOMERGPT_PROFILE` | Select a saved profile; overridden by `--profile` |
| `CUSTOMERGPT_CONFIG_FILE` | Override the user config location |
| `CUSTOMERGPT_OUTPUT` | `json` forces JSON output; `human` forces tables even when piped |
| `NO_COLOR` / `FORCE_COLOR` | Disable or force colored output |

`--api-base` overrides the server for a command. Otherwise the environment takes precedence over the saved server. Saved credentials are never sent to a different origin selected by an override. Public servers require HTTPS; loopback development servers can use HTTP.

## Troubleshooting

| Problem | Next step |
| --- | --- |
| `customergpt` is not found | Check Node.js and the npm global executable directory on PATH; restart your terminal |
| Login expires or reports 401 | Run `customergpt login` again; check whether an environment API key is overriding your session |
| Access denied / 403 | Check your account's API access, ownership and requested permissions |
| `CONFIRMATION_REQUIRED` | Review the action, then add `--yes`; use `--dry-run` to validate first |
| Bot not found | Use the bot's `data.id`, not its widget ID, and confirm the current account |
| Training times out | Inspect `jobs get JOB_ID`; a timeout does not cancel the job |
| Answer lacks website information | Check source training status and crawl warnings; JavaScript-rendered pages may require supplying text |
| New commands return 404 | Check the server address and deployment version; for the hosted service, report it via Support |

## FAQ

**Can anyone install the CLI?** Yes. The public npm package is available to everyone. Each person uses their own account and API credentials; authenticated API features depend on the plan.

**Can I try it without signing up?** Yes, through `onboarding start`, when anonymous onboarding is enabled. You receive a private preview URL and can claim the bot later.

**Can I run it in CI?** Yes. Provide `CUSTOMERGPT_API_KEY` as a secret, parse JSON output and check exit codes. Interactive browser login is unnecessary.

**Does `messages send` contact a customer?** No. It tests a single answer in preview mode and counts toward your message quota.

**Where is my API key in the widget snippet?** It is not included. The snippet uses a public widget ID.

**Is the hosted service also MIT-licensed or free?** MIT applies to the CLI package's code. It does not grant free hosted API usage or change service plan limits or the backend's license.

## Development

```bash
git clone https://github.com/Xursand7777/customergpt-cli.git
cd customergpt-cli
npm install
npm test
npm pack
customergpt login --api-base http://localhost:3000
```

Packaging runs tests and includes the executable, library, declarations, README and LICENSE. Installing the CLI does not start a local backend. New agent actions require the matching backend release.

## Support

- [CustomerGPT website](https://customergpt.ai)
- [Account dashboard](https://dashboard.customergpt.ai)
- [Report a CLI issue](https://github.com/Xursand7777/customergpt-cli/issues)

Include your CLI and Node.js versions, command and redacted error. Never include API keys, session files or private preview tokens.

## License

[MIT](https://github.com/Xursand7777/customergpt-cli/blob/main/LICENSE) © 2026 CustomerGPT. Applies to this CLI package; dependency licenses remain their own.
