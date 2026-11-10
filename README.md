# manus-cli

Local Manus AI agent runner — a Claude Code / Cursor-style terminal CLI for your [Manus](https://manus.im) subscription, with first-class [Herdr](https://herdr.dev) support.

Manus is a full agent API (plan → tools → deliverables), not a chat completion endpoint. This CLI turns that into an interactive local workflow you can run next to `claude`, `cursor`, and other agents.

## Install

```bash
# from source
git clone https://github.com/mol-x/manus-cli.git
cd manus-cli
npm install
npm run build
npm link

# or once published
npm install -g @mol-x/manus-cli
```

Requires Node.js 18+.

## Quick start

1. Create an API key in [Manus Developers](https://manus.im) (API settings).
2. Authenticate:

```bash
manus auth login
# or
export MANUS_API_KEY=sk-...
```

3. Run:

```bash
# Interactive REPL (like Claude Code / Cursor Agent)
manus

# One-shot
manus -p "Research solar inverter warranties and summarize in a table"

# Seed a REPL turn
manus "Draft a project brief for a homelab dashboard"

# Resume a task
manus --resume TASK_ID
manus task list
```

## Herdr

When `manus` runs inside a Herdr pane it reports lifecycle state automatically:

| State | When |
| --- | --- |
| `working` | Task created / message sent / polling |
| `blocked` | Manus is waiting for a question or confirmation |
| `idle` | Ready for the next prompt |

It also registers a resume command (`manus --resume <taskId>`) so Herdr can restore the same session after a server restart.

```bash
# inside Herdr
manus
herdr agent list          # should show manus as idle/working/blocked
```

No Herdr install step is required — the agent supports Herdr itself via `pane report-agent` + OSC 7501.

## Commands

| Command | Description |
| --- | --- |
| `manus` | Interactive REPL |
| `manus -p "..."` | One-shot prompt |
| `manus --resume <id>` | Continue an existing task |
| `manus --profile max` | Use lite / standard / max / max-* |
| `manus auth login` | Save API key to `~/.config/manus-cli/config.json` |
| `manus auth status` | Verify key |
| `manus task list` | Recent tasks |
| `manus task get <id>` | Task metadata |
| `manus whoami` | Authenticated user |
| `manus config show` | Effective config |

### REPL slash commands

| Command | Description |
| --- | --- |
| `/help` | Help |
| `/status` | Current task |
| `/url` | Open Manus webapp link |
| `/profile <name>` | Switch profile for next turns |
| `/yes` `/no` | Approve / reject pending confirmations |
| `/clear` | Next message starts a new task |
| `/exit` | Quit |

## Configuration

Resolution order for the API key:

1. `MANUS_API_KEY`
2. `~/.config/manus-cli/config.json`

```bash
manus config set defaultProfile max
manus config set pollIntervalMs 1500
manus config set interactiveMode true
```

Optional: `MANUS_BASE_URL` (default `https://api.manus.ai`).

## How it maps to the Manus API

| CLI action | API |
| --- | --- |
| First prompt | `POST /v2/task.create` |
| Follow-ups / answers | `POST /v2/task.sendMessage` |
| Progress | `GET /v2/task.listMessages` + `task.detail` |
| Tool confirmations | `POST /v2/task.confirmAction` |

Docs: [Manus API](https://manus.im/docs/integrations/manus-api) · [open.manus.ai](https://open.manus.ai/docs/v2/introduction)

## Development

```bash
npm install
npm run dev -- --help
npm run build
```

## License

MIT
