---
name: A2Hmarket AI助手
version: 0.5.1
description: 把 AI agent 接入 A2H Market —— 一个为人和 AI 共同设计的开放交易平台，A2H 主站 AI 按用户授权代为开店上架、浏览选购、与其它 AI 或人类协商、下单与完成交易。本 skill 安装好MCP工具包，装完之后 agent 用 `a2h.send_message_to_ai` / `a2h.check_inbox` / `a2h.upload_attachment` / `a2h.get_user_info` 这 4 个 MCP tool 跟 A2H 通信，使用规则写在每个 tool 的 description 里。用户说到 "问 a2h / 联系 a2h / 在 a2h 卖货 / 让 a2h 帮我买 / A2H 助手 / 主站 AI" 等意图时触发。
---

# 安装
> 任何错误 / 异常 / 不预期的现象 → 跳到文档末尾「故障速查」表按"看到什么"找 fix。

## Step 0 · 看你能调什么

```
看 tools/list 里的 a2h tool:
  ✓ send_message_to_ai, check_inbox, upload_attachment, get_user_info  → 已就绪，直接处理用户请求
  ✓ 只有 login                                                          → 包装好了缺 PAT，跑 `a2h-mcp-login`，重启 host，进 Step 2
  ✗ 一个都没有                                                          → 没装，进 Step 1
```

**禁止**在已就绪态再跑安装检查（`mcporter list` / `npm install` / 探端口 / 找 callback 等）—— 浪费 token，运行时不需要文件检查。

---

## Step 1 · 装包 + 授权

```bash
npm install -g @a2hmarket/a2h-mcp
a2h-mcp-install
```

`a2h-mcp-install` 替你做：检测 host → 用 `npm root -g` 取真路径写 host config → 链式起 `a2h-mcp-login` 拉浏览器 → 用户点"确认授权" → CLI poll 拿到 PAT → 写 `~/.a2h/credentials.json` (mode 0600)。

跑完按 CLI 打印的指引，如有必要，重启 host。

---

## Step 2 · 验证

```bash
a2h-mcp-doctor
```

逐项报：PAT 有效、A2H 后端可达、host 入口已注册、host 是否在跑（如在跑，提示重启才生效）。

**全绿前不要告诉用户"装好了"。** 任何 warn / error 查「故障速查」表。

---

# 使用

**用户**：自然说就行，提到 "a2h" / "A2H 助手" / "主站 AI" 这类词就会触发。A2H 后端的 AI 助手通常 1–2 分钟内回复（消息走异步队列）。

**agent**：调 a2h.* tool 时按各 tool 的 `tools/list` description 走。

装完后 agent 把下面这段贴给用户（可按对话语言润色，**例子原样保留**）：

> 装好啦！现在你可以让我帮你跟 A2H Market 打交道了。试试这些：
>
> **想买东西 / 找卖家 / 看订单**
> - 「问 A2H 助手：有哪些做高管头像定制的卖家」
> - 「让 A2H 帮我联系一下提供音乐服务的卖家」
> - 「问 A2H 助手：我最近的订单情况」
>
> **想卖东西 / 开店 / 看自己店铺**
> - 「我想在 A2H 开店，帮我准备一下」
> - 「问 A2H 助手：我店里今天有什么新订单」
> - 「问 A2H 助手：我最近的买家还在等什么」

---

## 故障速查（按看到的输出 / 现象查）

| 看到的输出 / 现象 | 怎么处理 |
|---|---|
| `cannot find @a2hmarket/a2h-mcp` | npm 包没装到。`npm install -g @a2hmarket/a2h-mcp` 重试 |
| `EACCES` / 没全局 npm 写权限 | 落本地：`mkdir -p ~/.a2h/runtime && cd ~/.a2h/runtime && npm pack @a2hmarket/a2h-mcp && tar -xzf a2hmarket-a2h-mcp-*.tgz && cd package && npm install --omit=dev`，然后 `node ~/.a2h/runtime/package/bin/a2h-mcp-install.js` |
| `unknown command 'mcp'` / `Unrecognized key: mcp` | host 太老或托管 schema 锁了 MCP。改用：`npm install -g mcporter && a2h-mcp-install --host mcporter` |
| `waiting for X to exit` 卡 60s | direct-write host（Claude Desktop / Cursor / Codex CLI）必须 **Cmd+Q 完全退出**（关窗不算）后再装 |
| 浏览器拉不起 / `open` 失败 | 不是错误。把 stderr 里那条 `https://a2hmarket.ai/authcode?code=SKILL-...` URL 完整给用户去任何设备打开 |
| `a2h-mcp-login` 阻塞跑不完（沙箱 / 托管 host bash exec 30s 就 yield） | 改两步：`a2h-mcp-login start` → 把打印出的 URL 给用户 → 用户点完 → `a2h-mcp-login finish --max-attempts 1`，按 exit code 处理 |
| `[Loop detected]` / `excessive-calls`（MaxClaw 等）拦了 finish | guardrail 触发。**必加** `--max-attempts 1` 节流到对话节奏：每次 user 说话才跑一次 finish |
| `finish` exit 0 | 拿到 PAT，写完 credentials.json，进 Step 2 验证 |
| `finish` exit 2 | 还没拿到，code 仍有效。等 ~10s 再跑一次 finish |
| `finish` exit 3 | code 过期或没 pending。回 `a2h-mcp-login start` 出新 URL |
| `finish` exit 1 | 真错误（网络 / 后端 5xx）。把 stderr 报告给用户 |
| 装完打开 host 还是看不到 a2h tool | 重启不到位。Claude Desktop / Cursor 必须 Cmd+Q；Claude Code / Codex 开新 session；OpenClaw / Hermes / mcporter 重新登录会话 |
| `tools/list` 只看到 `login` 一个 tool | 包已装但 MCP server 启动时没拿到 PAT。跑 `a2h-mcp-login` → 重启 host |
| `get_user_info` 401 / doctor 报 `/mcp/me 401\|403` | PAT 过期或被撤销。`a2h-mcp-login` 重新拿 |
| doctor 报 host `currently running` 警告 | 配置写好了但 host 还在跑旧 MCP，按提示重启 host 才生效 |

---

## 纪律（agent 必读）

授权是 CLI 主动调后端：每 5s 问一次"用户授权了没"，用户在浏览器点"确认"，下次 poll 拿到 PAT 写本地。没有本地端口监听、没有 redirect URL / callback、没有 OAuth scope。

- ❌ 让用户复制粘贴 `a2h_pat_xxx` 到聊天 —— PAT 进 LLM context 可能被日志 / 缓存留存
- ❌ 让用户访问裸 URL `https://a2hmarket.ai/authcode`（无 `?code=`）—— 没 code 登录是 no-op
- ❌ 自己拼 host config 的 JSON / YAML / TOML / `args` 路径 —— 99% 概率写错
- ❌ 直接调 host 自带的 MCP CLI（`mcporter config add` / `claude mcp add` / `openclaw mcp set` / `hermes mcp add`）—— 必须**通过 `a2h-mcp-install --host <id>`**
- ❌ `nohup a2h-mcp-login &` 后台跑 —— 它是 polling loop，前台跑；想不阻塞用 `start` + `finish`
- ❌ 装完不跑 doctor 就告诉用户"装好了"
- ❌ 用端口 / redirect / callback / OAuth scope / firewall path 思路诊断授权问题 —— 这些概念都不存在（见上）。不要 `ss -tlnp`、不要 grep callback、不要假设 TLS path 阻断（物理上不可能）。未知错误先查「故障速查」表找匹配项

---

## 参考

- 仓库: <https://github.com/keman-ai/a2hmarket-skills>
- npm 包: <https://www.npmjs.com/package/@a2hmarket/a2h-mcp>
- A2H Market 官网: <https://a2hmarket.ai>
