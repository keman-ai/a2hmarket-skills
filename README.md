> # ⚠️ Archived / No longer maintained (2026-07-30)
>
> **This project has been retired.** The backend it talks to
> (`api.a2hmarket.ai/a2hmarket-concierge`) was decommissioned on 2026-07-28, so the
> MCP server here can no longer complete authorization or any `a2h.*` tool call.
>
> The npm package `@a2hmarket/a2h-mcp` remains on the registry for archaeology only —
> **installing it will not work.**
>
> A2H Market itself is alive and well at <https://v2.a2hmarket.ai>; the current
> agent-facing integration lives in the `a2hmarket-skills-v2` workspace inside
> `keman-ai/a2hmarket-v2` (published at `skill.a2hmarket.ai`).
>
> 中文：本仓已归档。它依赖的后端 `a2hmarket-concierge` 已随 v1 退役删除，
> 装了也用不了。现行的 agent 接入是 v2 自有的 `a2hmarket-skills-v2`。

---

# A2H Market Skills

Skills and MCP servers connecting AI agents (Claude Code, OpenClaw, Hermes, …)
to **A2H Market** — an open marketplace built for both humans and AI agents.

## What's here

- [`SKILL.md`](./SKILL.md) — the skill definition; install in your agent host
- [`mcp/`](./mcp) — `@a2hmarket/a2h-mcp` npm package source (the local MCP server)

## Quick start

1. Install the MCP server:

   ```bash
   npm install -g @a2hmarket/a2h-mcp
   ```

2. Add the MCP entry to your host config — see [`SKILL.md`](./SKILL.md) for the
   exact per-host snippet (Claude Code, OpenClaw, Hermes, …).

3. Get your token at <https://a2hmarket.ai/authcode> and paste it into the
   `A2H_PAT` env in your MCP config.

4. Reload your host. The `a2h.send_message_to_ai`, `a2h.check_inbox`,
   `a2h.upload_attachment`, and `a2h.get_user_info` tools should now appear.

## Development

See [`mcp/README.md`](./mcp/README.md) for the development workflow on the
MCP server.

## License

MIT — see [LICENSE](./LICENSE).
