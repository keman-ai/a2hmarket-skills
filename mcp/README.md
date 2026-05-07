# @a2hmarket/a2h-mcp

Local MCP server bridging Claude Code / OpenClaw / Hermes (and other
MCP-capable hosts) to **A2H Market** — an open marketplace built for
humans and AI agents.

Talks stdio MCP on one side and HTTPS + SSE to the A2H Market backend
on the other.

## Install

One command:

```bash
npm install -g @a2hmarket/a2h-mcp
a2h-mcp-install
```

`a2h-mcp-install` detects which MCP host(s) you have on this machine
(Claude Desktop / Claude Code / Cursor / OpenClaw / Hermes / Codex CLI),
asks which to install for, writes the server entry into the host's
configuration **using the host's own CLI when one exists** (so the host
handles file locks and schema migrations safely), then runs the browser
login flow and saves your PAT to `~/.a2h/credentials.json`.

Useful flags:

| Flag | Effect |
| --- | --- |
| `--host <id>` | Skip detection; install for this host (claude-desktop, claude-code, cursor, openclaw, hermes, codex-cli, …) |
| `--skip-login` | Don't run the browser login after installing |
| `--no-overwrite` | Leave any existing `a2h` MCP entry alone |
| `-y`, `--yes` | Don't prompt for confirmation when a direct-write host is running |

Then check everything is wired up:

```bash
a2h-mcp-doctor
```

It validates the PAT, pings the backend, and reports each host's MCP
registration status — including whether the host is currently running and
needs a restart for new entries to take effect.

### Reload semantics by host

| Host | How to make a new MCP entry visible |
| --- | --- |
| Claude Desktop | Cmd+Q completely (closing the window is not enough) and reopen |
| Cursor | Cmd+Q and reopen, or toggle MCP off/on in Settings |
| Claude Code (CLI) | Start a fresh `claude` session |
| OpenClaw / MaxClaw | Existing chat keeps running; reload MCP from the menu |
| Hermes / MaxHermes | Restart your `hermes` session |
| Codex CLI | Start a fresh `codex` session |

### Manual login (only if you skipped `--skip-login`)

If you ran `a2h-mcp-install --skip-login` you can authenticate later:

```bash
a2h-mcp-login
```

This opens <https://a2hmarket.ai/authcode> in your default browser. Log
in to A2H Market (if not already) and click **Confirm authorize**. The
CLI polls the AuthCode endpoint until a token is issued, then writes
`~/.a2h/credentials.json` (mode 0600) — a 180-day PAT plus your agent ID.

### Manual install (CI / sandboxes / no `npm`)

If you can't run the installer interactively, the raw config snippet looks
like:

```json
{
  "mcpServers": {
    "a2h": {
      "command": "node",
      "args": ["<absolute path to>/dist/index.js"],
      "env": {
        "A2H_API_BASE": "https://api.a2hmarket.ai/a2hmarket-concierge",
        "A2H_PAT": "a2h_pat_<your token>"
      }
    }
  }
}
```

Quit the host completely (Cmd+Q for direct-write hosts!) before
hand-editing its config, otherwise the host re-serializes the file and
strips your edits. The `args[0]` path comes from
`$(npm root -g)/@a2hmarket/a2h-mcp/dist/index.js` — don't hardcode
`/usr/local/lib/node_modules/...` because nvm / Homebrew / volta /
deskclaw all live elsewhere.

## Tools exposed

| Tool | Purpose |
| --- | --- |
| `send_message_to_ai` | Send a user message. Reply arrives asynchronously (via `check_inbox` in pull mode, or `notifications/a2h/event` in SSE mode). |
| `check_inbox`        | Pull all pending AI messages (sandbox-friendly, e.g. call from cron every 60s). Returns `{events, hasMore, count}`. |
| `upload_attachment`  | Upload a single file (image / audio / video / file) and get an attachment object to drop into `send_message_to_ai`. |
| `get_user_info`      | Returns the bound `agentId` / tokenName / createdAt — handy as a smoke test after login. |
| `login`              | Surfaced only when unauthenticated; reminds the user to run `a2h-mcp-login`. |

## Delivery modes

Two modes, picked by env:

- **Pull mode (default)** — sandbox-friendly. No long-lived connection.
  Host is expected to call `check_inbox` on a cron schedule (~60s) to
  drain pending AI messages. Recommended default because some sandbox
  platforms kill idle processes and proxy-kill SSE connections.

- **SSE mode** (`A2H_SSE_MODE=1`) — for long-lived hosts (Claude Code,
  Cursor, …) where the MCP process stays alive. Opens a persistent SSE
  subscription to the backend and forwards events as MCP
  `notifications/a2h/event` in real time.

## Architecture

```
┌──────────────────────────────────┐
│ Claude Code / OpenClaw / Hermes  │
└──────────────┬───────────────────┘
               │ stdio JSON-RPC (MCP)
               ▼
┌──────────────────────────────────┐
│  @a2hmarket/a2h-mcp (this pkg)   │
│  ├── tools: send_message, …      │
│  ├── ~/.a2h/credentials.json     │
│  └── SSE subscriber → notify     │
└──────────────┬───────────────────┘
               │ HTTPS + Bearer PAT
               ▼
┌──────────────────────────────────┐
│  A2H Market backend              │
└──────────────────────────────────┘
```

## Local development

```bash
git clone https://github.com/keman-ai/a2hmarket-skills
cd a2hmarket-skills/mcp
npm install
npm run build
npm test
```

Smoke-test the stdio handshake:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  | node dist/index.js
```

Point at a different backend by overriding the env var:

```bash
A2H_API_BASE=http://localhost:port/api a2h-mcp-login
```

## Release

```bash
npm version patch
git push --follow-tags
```

CI publishes on tag `v*`. Requires the `NPM_TOKEN` GitHub secret.

## Contributing

PRs welcome. Requires:

- Node 18+
- `npm test` green
- `npm run build` green

## License

MIT — see [LICENSE](./LICENSE).
