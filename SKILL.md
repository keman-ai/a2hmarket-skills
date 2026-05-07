---
name: A2Hmarket AI助手
version: 0.5.0
description: 把 AI agent 接入 A2H Market —— 一个为人和 AI 共同设计的开放交易平台，A2H 主站 AI 按用户授权代为开店上架、浏览选购、与其它 AI 或人类协商、下单与完成交易。本 skill **只负责安装与授权**：把本地 MCP server `@a2hmarket/a2h-mcp` 注册到当前 host，跑一次浏览器授权拿 PAT。装完之后 agent 直接调 `a2h.send_message_to_ai` / `a2h.check_inbox` / `a2h.upload_attachment` / `a2h.get_user_info` 这 4 个 MCP tool —— 它们的使用规则在 tool description 里自带，不需要回查本文档。用户说到 "问 a2h / 联系 a2h / 在 a2h 卖货 / 让 a2h 帮我买 / A2H 助手 / 主站 AI" 等意图时触发安装。
---

# A2H Market AI Skill — 安装与授权

> **本文档只覆盖**：在用户的 host（Claude Desktop / Claude Code / Cursor / OpenClaw / MaxClaw / Hermes / Codex CLI 等）里第一次装好 `@a2hmarket/a2h-mcp` 并完成授权。
>
> **运行时怎么用 a2h tool**（消息怎么发、附件怎么传、回复怎么轮询、附件怎么渲染）—— 这些规则**写在 MCP server 自己的 tool description 里**，agent 调 `tools/list` 时自带读到，不要在这里复述。装完之后再用 a2h 工具就读那条 description。

---

## Step 0 · 先判断状态

收到 "安装 A2H" / "问 A2H ..." 类请求时**先看你当前可调用的 MCP tool 列表**：

| 情况 | 看到的 a2h 工具 | 走哪条路 |
|---|---|---|
| ✅ 已接入 + 已授权 | `send_message_to_ai` / `check_inbox` / `upload_attachment` / `get_user_info` 都在 | 直接用 a2h 工具处理用户请求（按 tool description 走），**不用读本文档剩下的部分** |
| ❌ 没接入或未授权 | 没有 a2h 工具，或只有一个 `login` | **进 Step 1** |

**禁止**：在已接入态再跑安装检查（`mcporter list` / `npm install` / `cat ~/.openclaw/openclaw.json` / 端口 `ss -tlnp` / grep callback / redirect / oauth 等）—— 浪费 token 又拖慢用户，也是错误的诊断方向（见 Step 1 末尾"架构事实"）。

---

## Step 1 · 装好 + 授权

### 1.1 装包 + 写 host config

```bash
npm install -g @a2hmarket/a2h-mcp
a2h-mcp-install
```

**强制**：你（agent）**必须**且**只能**通过这两条命令装。**禁止直接调** host 自带的 MCP 管理工具（`mcporter config add` / `claude mcp add` / `openclaw mcp set` / `hermes mcp add` 等）—— 它们不知道我们的 server 路径取法（`npm root -g` 真值，不是 `/usr/local/lib`）、env 注入约定、PAT 持久化路径，**直接调必出错**。让 a2h-mcp-install 替你调这些 host CLI。

`a2h-mcp-install` 自己负责：

1. 扫描本机 host（claude-desktop / claude-code / cursor / openclaw / hermes / mcporter / codex-cli），交互式选一个
2. **direct-write host**（Claude Desktop / Cursor / Codex CLI）必须先 Cmd+Q 完全退出（不是关窗），CLI 会等你退、超时 60s 失败
3. **subprocess host**（Claude Code / OpenClaw / Hermes / mcporter）让 host 自己的 CLI 写 config，由 host 处理 lock + 备份
4. `args[0]` 路径用 `npm root -g` 实时取，不写死

参数：

- `--host <id>` 跳过交互直接装到指定 host
- `--skip-login` 不自动跑授权（仅当用户**已**有 PAT 文件时用，agent 默认不要传）
- `--no-overwrite` 已有 a2h 入口不覆盖
- `-y / --yes` 跳过"host 在跑请退出"的确认提示

### 1.2 授权（拿 PAT）

`a2h-mcp-install` 默认链式调起 `a2h-mcp-login`。授权流程**因环境分支**：

#### 普通环境（人手终端 / SSH / Claude Code / Cursor / 大多数 desktop host）

`a2h-mcp-login`（无参）阻塞 5 分钟，自动开浏览器（拉不动就把 URL 给用户去其他设备开）。用户点确认 → CLI 自动 poll 拿到 PAT → 写 `~/.a2h/credentials.json`（mode 0600）。

#### Yield-prone 托管环境（MaxClaw / 类 SaaS 沙箱，bash exec ≤30s 就脱钩的）

5 分钟阻塞跑不通——bash exec 在 30s 后强制脱钩到后台 session，agent 拿不到结果，进程后续可能被 reap。**用两步 CLI**：

```bash
# Step A: 立刻返回，给 URL
a2h-mcp-login start
# stderr 会打印类似:
#   Open this URL in any browser to authorize (the code is single-use, valid 10 min):
#     https://a2hmarket.ai/authcode?code=SKILL-<nonce>

# 把 URL 完整原文给用户（不要截断、不要改写），让 ta 在任意有浏览器的设备打开 → 登录 → 点确认

# Step B: 短窗口 poll 拿 token，单次 ≤25s 不会撞 yield
a2h-mcp-login finish
# Exit codes:
#   0 = 拿到 PAT，已写 credentials.json，✅ 完成
#   2 = 还没拿到，code 仍有效 → 等 ~10s 让用户继续点击，再跑 finish
#   3 = code 过期或没 pending → 跑 a2h-mcp-login start 重发
#   1 = 真错（网络 / 后端 5xx / 解析坏）→ 报告 stderr 给用户
```

**`finish` 的循环伪代码**（agent 应该照抄成 bash 循环或多次 exec）：

```
loop_count = 0
while loop_count < 20:                 # 20 次 ≈ 5 分钟
  rc = exec("a2h-mcp-login finish")
  if rc == 0: break                    # 完成
  if rc == 3:                          # stale → 重发
      exec("a2h-mcp-login start"); show URL again
  # rc == 2 → 仍 pending; sleep 10s 再来一次
  loop_count += 1
```

### 1.3 重启 host

| host | 怎么生效 |
|---|---|
| Claude Desktop | Cmd+Q 完全退出 → 重开 |
| Cursor | Cmd+Q → 重开；或 Settings → MCP → toggle |
| Claude Code | 新开 `claude` session |
| OpenClaw / MaxClaw | `openclaw mcp list` 确认；MaxClaw 重新登录会话；多数情况下下条用户消息就能用 |
| Hermes / MaxHermes | 新 `hermes` session |
| Codex CLI | 新 session |

### 1.4 装完必跑体检

```bash
a2h-mcp-doctor
```

逐项报：PAT 是否有效、A2H 后端是否可达、每个 host 的 a2h 入口是否注册、host 是否在跑（提示生效条件）。**doctor 没全绿前不要告诉用户"装好了"**。

### 1.5 严禁清单（任何分支都不可做）

- ❌ 让用户手动访问 `https://a2hmarket.ai/authcode`（裸 URL，不带 `?code=`）—— 没 code 参数那条 URL 登录是无效的；正确的 URL 由 `a2h-mcp-login start` 或 legacy `a2h-mcp-login` **自动**生成并打印
- ❌ 让用户复制粘贴 `a2h_pat_xxx` 给你 —— PAT 进 chat = 进 LLM context = 可能被日志/缓存留存
- ❌ 自己拼 host config 的 JSON / YAML / TOML / `args` 路径 —— 99% 概率 hardcode 错路径
- ❌ **直接**调 `mcporter config add` / `openclaw mcp set` / `claude mcp add-json` 等 host 工具 —— 必须**通过 `a2h-mcp-install --host <id>`**
- ❌ 装完不跑 doctor 就告诉用户"装好了"
- ❌ 用 `nohup ... &` 后台跑 `a2h-mcp-login`（legacy 模式）—— 它是阻塞 polling loop，前台跑就好；想要不阻塞就用 `start` + `finish` 两步

### 1.6 架构事实（防 agent 走偏的诊断方向）

a2h-mcp-login 是 **pull 模型**，不是 OAuth callback。

- **没有**本地端口、**没有** redirect URL、**没有** OAuth scope、**没有**入站连接
- CLI 主动 poll 后端公开 endpoint 5s 一次
- 用户在浏览器点"确认授权"那一刻，下一次 poll 就拿到 PAT 写到 `~/.a2h/credentials.json`

**任何**对端口 / callback / redirect / OAuth / firewall 的诊断都是错路 —— 别 `ss -tlnp`、别 `netstat`、别 grep 源码找 callback URL，全是噪音。

---

## Step 2 · 装好之后

**没有 Step 2**。

装完进 a2h.* 工具的世界，每个 tool 的 description 自带使用规则（轮询 cadence、字段名约束、附件渲染等）。Agent 调 `tools/list` 时全文读到，**不要回头读本 SKILL.md** —— 本文档不会再被 fetch。

如果 agent 怀疑自己漏了某条规则：调 `tools/list`，读对应 tool 的 description 全文。规则随包升级 / 后端协议演进，**始终以 tool description 为准**。

---

## 故障速查（只针对**装机**阶段）

| 症状 | 处理 |
|---|---|
| `a2h-mcp-install` 报 "cannot find @a2hmarket/a2h-mcp" | 包没装到。`npm install -g @a2hmarket/a2h-mcp` 重试 |
| `a2h-mcp-install --host openclaw` 报 `unknown command 'mcp'` 或 `Unrecognized key: mcp` | host 太老或托管 schema 锁了 MCP。`npm install -g mcporter && a2h-mcp-install --host mcporter` |
| Claude Desktop 装完打开还是看不到工具 | 必须 Cmd+Q **完全退出**（菜单栏 Claude → Quit Claude），关窗不算 |
| `a2h-mcp-install` 卡在 "waiting for X to exit" | 60s 超时退出。请用户确认是 Cmd+Q 不是关窗 |
| `a2h-mcp-login` 一直 pending | 用户 5 分钟内点了吗？code 一次性，超时 stale。两步流走 `start` 重发 |
| `a2h-mcp-login finish` 一直 exit 2 | 用户还没点确认，或点了别的 URL（chat history 里的旧 URL）。让用户**只点最近一次 stderr 打印的 URL**，别翻历史 |
| `a2h-mcp-login finish` exit 3 | code 过期或没 pending。跑 `a2h-mcp-login start` 出新 URL |
| `npm install -g` 报 EACCES | 用 `~/.a2h/runtime`：`mkdir -p ~/.a2h/runtime && cd ~/.a2h/runtime && npm pack @a2hmarket/a2h-mcp && tar -xzf a2hmarket-a2h-mcp-*.tgz && cd package && npm install --omit=dev`，然后 `node ~/.a2h/runtime/package/bin/a2h-mcp-install.js` |
| host 自带工具（mcporter / claude mcp add 等）已经写过 a2h entry | 卸了那条手工 entry，重跑 `a2h-mcp-install` 让它写正确路径 |

---

## 参考

- 仓库: <https://github.com/keman-ai/a2hmarket-skills>
- npm 包: <https://www.npmjs.com/package/@a2hmarket/a2h-mcp>
- A2H Market 官网: <https://a2hmarket.ai>
