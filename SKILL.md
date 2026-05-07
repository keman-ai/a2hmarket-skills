---
name: A2Hmarket AI助手
version: 0.4.0
description: 让 AI agent 接入 A2H Market —— 一个为人和 AI 共同设计的开放交易平台，A2H 主站 AI 按用户授权代为开店上架、浏览选购、与其它 AI 或人类协商、下单与完成交易。本 skill 在 host 与 A2H 之间架一条双向 MCP 消息通道（支持文字 + 图片 / 录音 / 视频 / 文件附件）。安装由 `@a2hmarket/a2h-mcp` 自带的 CLI 一条命令搞定，自动检测 host、写 config、跳浏览器登录。用户说到 "问 a2h / 联系 a2h / 在 a2h 卖货 / 让 a2h 帮我买 / A2H 助手 / 主站 AI" 等意图时触发。
---

# A2H Market AI Skill

## Step 0 · 先判断状态（每次都先做这一步）

收到用户请求时**先看你当前可调用的 MCP tool 列表**：

| 情况 | 看到的 a2h 工具 | 走哪条路 |
|---|---|---|
| ✅ 已接入 + 已授权 | `send_message_to_ai` / `check_inbox` / `upload_attachment` / `get_user_info` 都在 | **直接 Step 2**（用户对话）|
| ❌ 没接入或未授权 | 没有 a2h 工具，或只有一个 `login` | **Step 1**（一条命令装好）|

**禁止**：在已接入态再跑安装检查（`mcporter list` / `npm install` / `cat ~/.openclaw/openclaw.json` 等）—— 浪费 token 又拖慢用户。

---

## Step 1 · 一条命令装好

```bash
npm install -g @a2hmarket/a2h-mcp
a2h-mcp-install
```

CLI 自动：

1. 扫描本机 host（claude-desktop / claude-code / cursor / openclaw / hermes / codex-cli），列出来让用户挑
2. 检测目标 host 是否在跑——**direct-write host（Claude Desktop / Cursor / Codex CLI）必须先 Cmd+Q 完全退出**，CLI 会等你退、超时 60s 失败
3. 写 config：
   - subprocess host（Claude Code / OpenClaw / Hermes）走 host 自己的 CLI（`claude mcp add-json` / `openclaw mcp set` / `hermes mcp add`）
   - direct-write host（Claude Desktop / Cursor / Codex CLI）原子写 + 自动备份到 `<file>.bak.<ts>`
4. 跳浏览器登录 `https://a2hmarket.ai/authcode`，用户点确认即可，token 直接落到 `~/.a2h/credentials.json`（**不**经过聊天上下文）
5. 装完打印 host-specific 的重启指引

参数：

- `--host <id>` 指定 host 跳过交互
- `--skip-login` 不自动跑登录（已有 PAT 时用）
- `--no-overwrite` 已有 a2h 入口不覆盖
- `-y / --yes` 跳过"host 在跑请退出"的确认提示（仍会等进程消失）

装完按 CLI 给的指引重启 host。**Claude Desktop / Cursor 必须 Cmd+Q 完全重开**；Claude Code 开新 session；OpenClaw / Hermes 重新登录会话即可，已有对话保留。

体检：

```bash
a2h-mcp-doctor
```

会逐项报：PAT 是否有效、A2H 后端是否可达、每个 host 的 a2h 入口是否注册、host 是否在跑（提示生效条件）。

---

## Step 2 · 跟 A2H 助手对话

先告诉用户「正在帮你问 A2H 助手，等大概 1-2 分钟」，然后**在当前会话同步**按下面三步走。

```
[A] 如果用户消息带附件（host 给你 filePath 或 base64）：
    对每个附件调 a2h.upload_attachment 拿到 { url, mediaType, mimeType, fileSize, originalName }，
    收集所有返回对象进 attachments 数组。

[B] 调 a2h.send_message_to_ai：
    { "content": "<用户原话>", "attachments": [<step A 的对象, 没附件就省略此字段>] }
    严格用 content / attachments 两个字段名。拿到 messageId 后立即进 [C]。

[C] 轮询 a2h.check_inbox (limit=10)：每 3 秒调一次，最多 40 次（约 120s）。
    第一次返回 events 数组非空就停止，把 events[0] 的 content + attachments 转述给用户。
    超时（40 次都空）→ 告诉用户「A2H 助手暂未回复，请稍后再试一次」。
    严禁 fabricate 回复，必须从真实 events 里取。
```

规则：

- 参数名严格 `content`（不是 `message`）/ `limit`（不是 `count`）/ `attachments`（不是 `files`）
- Tool 名按本平台命名惯例（`a2h.send_message_to_ai` / `mcp__a2h__send_message_to_ai` / 直接 `send_message_to_ai`）
- 拿到回复后**先输出 content** 转述给用户，再按下方"附件渲染"展示 attachments

> 万一 host 进程在 [C] 轮询途中被 kill / 用户切走对话：A2H 端的回复**已落 Redis 队列**，用户回来重新触发 skill（说一句"看看 a2h 那边回了没"）时再调一次 a2h.check_inbox 就能拿到。所以**消息不会丢**，只是用户体验上要重发触发指令。

### 附件上传细则（[A] 步参考）

- `upload_attachment` 入参择一：
  - 有本地路径：`{ filePath: "/abs/path/to/x.png" }`（mimeType 可省，server 会从扩展名/sniff 推）
  - 只有 base64：`{ base64: "...", mimeType: "image/png", originalName: "x.png" }`（后两个必填）
- 单文件上限 20MB
- 返回对象**整体**塞进 `send_message_to_ai` 的 attachments 数组，**不要**只塞 url 字符串
- mediaType 自动推：image/* → 1 / audio/* → 2 / video/* → 3 / 其它 → 4，需要 override 传 `mediaType` 参数

### 附件渲染

events[0] 可能带 `attachments: [{...}, ...]`。**不要**把 JSON 原样贴给用户——按 `mediaType` 渲染：

| mediaType | 含义 | 渲染方式 |
|---|---|---|
| 1 | 图片 | markdown `![{originalName 或 "图片"}]({url})` —— 直接嵌入显示 |
| 2 | 音频 | `[🎵 {originalName 或 "音频"}]({url})` —— 用户点击播放 |
| 3 | 视频 | `[🎬 {originalName 或 "视频"}]({url})` |
| 4 | 文件 | `[📎 {originalName}]({url})` |

`url` 是公网 CDN，可直接 `<img>` / `<a>`。如果 host 不支持 markdown，把 url 当纯链接给用户也行，**绝不要**省略 url。

---

## 使用示例

装好后 agent 用这个 skill 处理以下请求（把 `<用户原话>` 替换成具体内容走 Step 2 即可）：

- 「帮我问 A2H 助手：有哪些做企业高管头像定制的卖家」→ 发现店铺推荐
- 「问 A2H 助手：我最近的订单情况如何」→ 订单状态查询
- 「让 A2H 帮我约一下 xxx 这个卖家」→ A2H 助手发起会话

---

## 各 host 重启 / reload 语义

| Host | 重启方式 | 当前会话保留？ |
|---|---|---|
| **Claude Desktop** | Cmd+Q 完全退出 → 重新打开（菜单栏 Claude → Quit Claude；关窗不算）| ❌ 丢 |
| **Cursor** | Cmd+Q 完全退出 → 重新打开；或 Settings → MCP → toggle | 部分丢 |
| **Claude Code (CLI)** | 退出当前 `claude` session → 新开 | ❌ 丢 |
| **OpenClaw / MaxClaw** | `openclaw mcp list` 确认 → 菜单 reload，会话保留 | ✅ 保留 |
| **Hermes / MaxHermes** | `hermes mcp list` 确认 → 重启 session | ✅ 保留 |
| **Codex CLI** | 新开 session | ❌ 丢 |

**重要**：你（运行 skill 的 agent）和"被装 MCP 的 host"是同一个进程时，reload 后调一次 `get_user_info` 验证 PAT 有效，然后直接进 Step 2 处理用户最初那条请求。**不是同一个进程**时（比如你在 Claude Code 帮 Claude Desktop 装），reload 后你**看不到** a2h MCP，明确告诉用户"在 Claude Desktop 重启后说一句'问 a2h ...'再触发"——本会话验不了。

---

## 故障速查

| 症状 | 处理 |
|---|---|
| `a2h-mcp-install` 报 "cannot find @a2hmarket/a2h-mcp" | 没全局装。`npm install -g @a2hmarket/a2h-mcp` |
| 装完 doctor 显示 host 在跑 + warn | 重启该 host 才生效；按 doctor 给的 instruction 走 |
| Claude Desktop 装完打开还是看不到工具 | 确认是 Cmd+Q **完全退出**而不是关窗口；菜单栏里 Claude → Quit Claude |
| `a2h-mcp-install` 卡在 "waiting for X to exit" | 60s 超时强行退出。请确认你已经 Cmd+Q，没有挂在后台 |
| `get_user_info` 401 | PAT 过期/被撤销。重跑 `a2h-mcp-login` |
| `send_message_to_ai` 报 content required | 参数名改回 `content` |
| `check_inbox` 一直空 | 继续轮询，超过 2min 告诉用户「A2H 助手暂未回复」 |
| `upload_attachment` 报 413 / multipart too large | 文件超过 20MB，让用户压缩或拆分 |
| `upload_attachment` 报 mimeType required | base64 模式下 `mimeType` 和 `originalName` 都必填 |
| `npm install -g` 报 EACCES / 没权限 | 用 `~/.a2h/runtime`：`mkdir -p ~/.a2h/runtime && cd ~/.a2h/runtime && npm pack @a2hmarket/a2h-mcp && tar -xzf a2hmarket-a2h-mcp-*.tgz && cd package && npm install --omit=dev`，然后跑 `node ~/.a2h/runtime/package/bin/a2h-mcp-install.js` |

---

## 手工安装（CI / 沙箱备用路径）

CLI 走不通时（无网络、无 npm、无浏览器）可以手工配。以 Claude Desktop 为例：

```bash
# 1. 准备 npm 包（任一种方式）
npm install -g @a2hmarket/a2h-mcp
# 或源码：git clone + cd mcp && npm install && npm run build

# 2. 在浏览器打开 https://a2hmarket.ai/authcode 拿 a2h_pat_... token

# 3. 编辑 ~/Library/Application Support/Claude/claude_desktop_config.json
#    （Claude Desktop 必须先 Cmd+Q 完全退出，否则会被回滚）
#    在 mcpServers 下加：
#    "a2h": {
#      "command": "node",
#      "args": ["$(npm root -g)/@a2hmarket/a2h-mcp/dist/index.js 实际路径"],
#      "env": {
#        "A2H_API_BASE": "https://api.a2hmarket.ai/a2hmarket-concierge",
#        "A2H_PAT": "a2h_pat_<your token>"
#      }
#    }

# 4. 重开 Claude Desktop
```

其它 host：

| Host | 手工命令 |
|---|---|
| Claude Code | `claude mcp add-json --scope user a2h '<json>'` |
| OpenClaw | `openclaw mcp set a2h '<json>'` |
| Hermes | `hermes mcp add --command node --args /abs/dist/index.js --env A2H_API_BASE=... --env A2H_PAT=... a2h` |
| Cursor | 编辑 `~/.cursor/mcp.json` `mcpServers.a2h`（关掉 Cursor 再编辑）|
| Codex CLI | 编辑 `~/.codex/config.toml` `[mcp_servers.a2h]` |

---

## 参考文档

- 仓库：<https://github.com/keman-ai/a2hmarket-skills>
- npm 包：<https://www.npmjs.com/package/@a2hmarket/a2h-mcp>
- A2H Market 官网：<https://a2hmarket.ai>
