---
name: A2Hmarket AI助手
version: 0.4.2
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

**强制**：你（agent）**必须**且**只能**通过下面两条 npm 命令装。**禁止直接调** host 自带的 MCP 管理工具（`mcporter config add` / `claude mcp add` / `openclaw mcp set` / `hermes mcp add` 等）—— 它们不知道我们的 server 路径取法（`npm root -g` 真值，不是 `/usr/local/lib`）、env 注入约定、PAT 持久化路径，**直接调必出错**。让 a2h-mcp-install 替你调这些 host CLI。

```bash
npm install -g @a2hmarket/a2h-mcp
a2h-mcp-install
```

a2h-mcp-install 自己负责：

1. 扫描本机 host（claude-desktop / claude-code / cursor / openclaw / hermes / mcporter / codex-cli），交互式选一个
2. 检测目标 host 是否在跑——**direct-write host（Claude Desktop / Cursor / Codex CLI）必须先 Cmd+Q 完全退出**，CLI 会等你退、超时 60s 失败
3. **取真实 npm root 路径**（不是 `/usr/local/lib/...` 写死，是 `npm root -g` 实时取）写到 host config 的 `args[0]`
4. 写 config：
   - subprocess host（Claude Code / OpenClaw / Hermes / mcporter）让 host **自己的** CLI 写，由 host 处理 lock + 备份
   - direct-write host（Claude Desktop / Cursor / Codex CLI）原子写 + 自动备份到 `<file>.bak.<ts>`
5. 链式调 a2h-mcp-login：**自己**起浏览器、**自己**生成 16-hex code、**自己** poll 后端、**自己**把 PAT 落到 `~/.a2h/credentials.json`（mode 0600）—— **PAT 全程不进你的 chat 上下文**
6. 装完打印 host-specific 重启指引

**严禁**（任何分支都不可以做的）：

- ❌ 让用户手动访问 `https://a2hmarket.ai/authcode`（裸 URL，不带 `?code=<nonce>`）—— 这条 URL 没 code 参数登录是无效的
- ❌ 让用户复制粘贴 `a2h_pat_xxx` 给你 —— PAT 进 chat = 进 LLM context = 可能被日志/缓存留存
- ❌ 自己拼 host config 的 JSON / YAML / TOML / `args` 路径 —— 99% 概率 hardcode 错路径（`/usr/local/lib` 在 nvm / volta / Homebrew Apple Silicon / deskclaw bundled node 下都不对）
- ❌ **直接**调 `mcporter config add` / `openclaw mcp set` / `claude mcp add-json` 等 host 工具 —— 必须**通过 `a2h-mcp-install --host <id>`** 走，让我们替你处理路径解析和 env 注入
- ❌ 装完不验证就告诉用户"装好了"

参数（仅 a2h-mcp-install 自身）：

- `--host <id>` 指定 host，跳过交互式选
- `--skip-login` 不自动跑登录（仅当用户**已**有 PAT 时才用，agent 默认不要传）
- `--no-overwrite` 已有 a2h 入口不覆盖
- `-y / --yes` 跳过"host 在跑请退出"的确认提示（仍会等进程消失）

装完按 CLI 给的指引重启 host。**Claude Desktop / Cursor 必须 Cmd+Q 完全重开**；Claude Code 开新 session；OpenClaw / Hermes 重新登录会话即可，已有对话保留。

**装完必跑体检**：

```bash
a2h-mcp-doctor
```

逐项报：PAT 是否有效、A2H 后端是否可达、每个 host 的 a2h 入口是否注册、host 是否在跑（提示生效条件）。**doctor 没全绿前不要告诉用户"装好了"**。

### 装到 MaxClaw / 老版本 OpenClaw / 其它 schema-locked 托管环境

如果 a2h-mcp-install 报 `unknown command 'mcp'` 或 `Unrecognized key: mcp` —— 这是 **托管环境（MaxClaw / OpenClaw < 2026.4 / 部分企业版）锁了 MCP 配置**，用 host 自己的 CLI 装不进去。

**走 mcporter 兜底**：

```bash
npm install -g mcporter   # 一次性，已有可跳过
a2h-mcp-install --host mcporter
```

mcporter 是通用 MCP CLI，写到 `~/.mcporter/mcporter.json`，受 schema lock 限制的托管 host（典型 MaxClaw）会从这里读 MCP server。

### 装到无头 / 无 GUI 浏览器的服务器（headless）

a2h-mcp-login 链式调起来后，如果 **`open` 不能拉浏览器**（headless / SSH server / 沙箱），脚本**会**：

- 把 `https://a2hmarket.ai/authcode?code=<nonce>` 这条 URL 打印到 stderr
- 继续 poll 后端 5 分钟等用户授权

agent 此时该做的：

1. 把 URL **完整原文**给用户：「请在你电脑/手机的浏览器打开下面这条链接授权（这条 URL 带一次性 code，是为本次安装准备的）：`https://a2hmarket.ai/authcode?code=...`」
2. **不要**截断 URL，**不要**改写 URL，**不要**说"无法授权"就放弃 —— 脚本还在 poll，用户在另一台设备授权完，我们这侧自动收 token 落 `~/.a2h/credentials.json`
3. **依然不要**让用户复制 `a2h_pat_xxx` 回聊天 —— 整条 token 走文件不走对话

如果用户 5 分钟没完成授权，脚本超时退出，agent 重跑 `a2h-mcp-login` 即可（会生成新的 code）。

### a2h-mcp-install 都跑不动怎么办

**绝大多数情况下不应该走到这里**。下面只在 npm 真的不可用时按顺序尝试：

1. **用 `npx` 不全局装**：`npx -y @a2hmarket/a2h-mcp@latest a2h-mcp-install`（会装到 `~/.npm/_npx` 临时缓存，沙箱重启可能丢但首次能装通）
2. **EACCES 没全局写权限**：`mkdir -p ~/.a2h/runtime && cd ~/.a2h/runtime && npm pack @a2hmarket/a2h-mcp && tar -xzf a2hmarket-a2h-mcp-*.tgz && cd package && npm install --omit=dev`，然后 `node ~/.a2h/runtime/package/bin/a2h-mcp-install.js`（注意：仍是用我们的 install 二进制，**不**是手抄 config）
3. **真的没 node**：告诉用户当前 host 环境缺 node 18+，请先装 node 再回来 —— **不要**降级到手写 config 这条死路

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
| `a2h-mcp-install` 报 "cannot find @a2hmarket/a2h-mcp" | 包没装好。`npm install -g @a2hmarket/a2h-mcp` 后重试 |
| 装完 doctor 显示 host 在跑 + warn | 重启该 host 才生效；按 doctor 给的 instruction 走 |
| Claude Desktop 装完打开还是看不到工具 | 确认是 Cmd+Q **完全退出**而不是关窗口；菜单栏里 Claude → Quit Claude |
| `a2h-mcp-install` 卡在 "waiting for X to exit" | 60s 超时强行退出。请确认你已经 Cmd+Q，没有挂在后台 |
| `get_user_info` 401 | PAT 过期/被撤销。重跑 `a2h-mcp-login`（**不要**让用户手抄 token） |
| `send_message_to_ai` 报 content required | 参数名改回 `content` |
| `check_inbox` 一直空 | 继续轮询，超过 2min 告诉用户「A2H 助手暂未回复」 |
| `upload_attachment` 报 413 / multipart too large | 文件超过 20MB，让用户压缩或拆分 |
| `upload_attachment` 报 mimeType required | base64 模式下 `mimeType` 和 `originalName` 都必填 |
| `npm install -g` 报 EACCES / 没权限 | 见 Step 1 末尾"a2h-mcp-install 跑不动怎么办"第 2 条 |
| host 自带的 mcp 工具（mcporter / claude mcp add）写完后 a2h tool 没出来 | 这是因为没用 a2h-mcp-install。卸了那条手工 entry，重跑 `a2h-mcp-install` |

---

## 参考文档

- 仓库：<https://github.com/keman-ai/a2hmarket-skills>
- npm 包：<https://www.npmjs.com/package/@a2hmarket/a2h-mcp>
- A2H Market 官网：<https://a2hmarket.ai>
