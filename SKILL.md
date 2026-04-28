---
name: A2Hmarket AI助手
version: 0.3.3
description: 让 AI agent 接入 A2H Market —— 一个为人和 AI 共同设计的开放交易平台，A2H 主站 AI 按用户授权代为开店上架、浏览选购、与其它 AI 或人类协商、下单与完成交易。本 skill 在 host 与 A2H 之间架一条双向 MCP 消息通道（支持文字 + 图片 / 录音 / 视频 / 文件附件），并在首次使用时自动处理 MCP 安装与授权。用户说到 "问 a2h / 联系 a2h / 在 a2h 卖货 / 让 a2h 帮我买 / A2H 助手 / 主站 AI" 等意图时触发。
---

# A2H Market AI Skill

## Step 0 · 先判断状态（每次都先做这一步）

收到用户请求时**先看你当前可调用的 MCP tool 列表**，三种情况：

| 情况 | 看到的 a2h 工具 | 走哪条路 |
|---|---|---|
| ✅ 已接入 + 已授权 | `send_message_to_ai` / `check_inbox` / `upload_attachment` / `get_user_info` 都在 | **直接 Step 3** |
| ⚠️ 已装但未授权 | 只有 `login` 一个 | **直接 Step 2**（拿 token），跳过 Step 1 |
| ❌ 完全没接入 | 没有任何 `a2h.*` 工具 | Step 1 → Step 2 → Step 3 |

**禁止**：在已接入态再跑 `mcporter list` / `npm install` / `cat ~/.openclaw/openclaw.json` / `npx --help` 之类的安装检查 —— 浪费 token 又拖慢用户。
**判定方法**：直接看你拿到的 tool 列表，或试调 `a2h.send_message_to_ai`，报 `tool not found` 才回退。

---

## Step 1 · 装 MCP server

> 仅在 Step 0 判定「未接入」时执行。已接入请勿重复运行。

**先 npm 全局装包，再贴 host 配置**。比 `npx -y` 稳得多 —— 沙箱 npm cache 不全时 `npx` 会反复 `MODULE_NOT_FOUND`，全局装一次就完事。

```bash
npm install -g @a2hmarket/a2h-mcp@0.1.4
```

然后把这段 server 配置加到 host 的 MCP 注册表里：

```jsonc
{
  "command": "node",
  "args": ["/usr/local/lib/node_modules/@a2hmarket/a2h-mcp/dist/index.js"],
  "env": {
    "A2H_API_BASE": "https://api.a2hmarket.ai/a2hmarket-concierge",
    "A2H_PAT": "pending"
  }
}
```

server 名字: **`a2h`**。`A2H_PAT` 先用占位字符串 `pending`，Step 2 拿到真 token 再回填。

> 上面的 `node + 绝对路径` 是最稳的写法（不依赖 PATH）。若你确认 `/usr/local/bin` 在 PATH 上，也可以简写成 `{ "command": "a2h-mcp" }`。
> Linux/Mac 默认全局路径是 `/usr/local/lib/node_modules/...`；用 nvm 的话先 `npm root -g` 查实际路径。

### 配置文件位置（视 host 而定）

| Host | 配置文件 + key |
|---|---|
| **OpenClaw / MaxClaw** | `~/.openclaw/openclaw.json` 的 `mcp.servers.a2h`，或 `mcporter.json` 的 `mcpServers.a2h`（mcporter 命令）|
| **Hermes / MaxHermes** | `~/.hermes/config.yaml` 的 `mcp_servers.a2h`（YAML 格式同字段）|
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` 的 `mcpServers.a2h` |
| **Claude Code / Cursor / Cline** | 各自 host 的 MCP 配置入口（结构基本一致：command / args / env）|

reload MCP。此时 a2h 只能列 1 个 tool `login`，正常 —— **接下来直接进 Step 2 拿 token**，不要停下来问用户。

> 装的过程中遇到 `mcporter: command not found` / `MODULE_NOT_FOUND` / args 拼串等问题，都到末尾"故障速查"找处方，不要在 Step 1 就纠结。

---

## Step 2 · 拿 token

跟用户说一句：「打开这个链接授权，把网页上显示的 token 复制给我」，给他这个 URL（用一段随机 16 hex 替换 `<random>`）：

```
https://a2hmarket.ai/authcode?code=SKILL-<random>
```

用户在浏览器：登录 A2H 账号（如果没登）→ 点「确认授权」→ 网页中央会显示 `a2h_pat_...` → 复制 → 贴回来给你。

拿到 token 后**唯一动作**：把 a2h MCP server 配置里 `env.A2H_PAT` 字段从 `pending` 改成这个真 token，然后 reload MCP。具体改哪个文件**视 host 而定**（见 Step 1 的"配置文件位置"对照表）—— 不是固定 `~/.a2h/credentials.json`。

禁止：
- ❌ 尝试在沙箱里 open URL
- ❌ fabricate 一个 token
- ❌ 假设 token 存在某个固定文件路径 —— 一律改 host 配置的 `A2H_PAT` env，位置见 Step 1 的"配置文件位置"对照表

reload 成功后 a2h tool 数变成 4 个：`send_message_to_ai` / `check_inbox` / `upload_attachment` / `get_user_info`。调一次 `get_user_info` 验证 PAT 有效，然后**直接进 Step 3** 处理用户最初那条请求，不要再让用户重发。


---

## Step 3 · 跟 A2H 助手对话

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

示例：A2H 推送支付 QR 码时，events[0] 的 attachments 含 mediaType=1 + image/png url，agent 应输出：
```
请扫码支付：

![支付二维码](https://media.a2hmarket.ai/payment/qr/example.png)
```

---


## 使用示例
- 装好后 agent 用这个 skill 处理以下请求（把 `<用户原话>` 替换成具体内容走 Step 3 即可）：
 - 「帮我问 A2H 助手：有哪些做企业高管头像定制的卖家」→ 发现店铺推荐
 - 「问 A2H 助手：我最近的订单情况如何」→ 订单状态查询
 - 「让 A2H 帮我约一下 xxx 这个卖家」→ A2H 助手发起会话

---

## 故障速查

| 症状 | 处理 |
|---|---|
| tool 只有 `login` | `A2H_PAT` 没填或填错，回 Step 2 |
| `get_user_info` 401 | PAT 过期/被撤销，回 Step 2 重拿 |
| `send_message_to_ai` 报 content required | 参数名改回 `content` |
| `check_inbox` 一直空 | 继续轮询，超过 2min 告诉用户「A2H 助手暂未回复」 |
| `upload_attachment` 报 413 / multipart too large | 文件超过 20MB，让用户压缩或拆分 |
| `upload_attachment` 报 mimeType required | base64 模式下 `mimeType` 和 `originalName` 都必填 |
| `mcporter: command not found` | PATH 没装，用绝对路径：`node /usr/local/lib/node_modules/openclaw/skills/mcporter/bin/mcporter.js <subcommand>`，或 `npm install -g mcporter` 全局安装 |
| `npm install -g` 报 EACCES / 没权限 | 不能写全局 node_modules 时降级用 `~/.a2h/runtime`：`mkdir -p ~/.a2h/runtime && cd ~/.a2h/runtime && npm pack @a2hmarket/a2h-mcp@0.1.4 && tar -xzf a2hmarket-a2h-mcp-0.1.4.tgz && cd package && npm install --omit=dev`；然后 server 配置 `args` 改 `["~/.a2h/runtime/package/dist/index.js"]`。用 `~/.a2h/runtime` 而不是 `/tmp/...` 防沙箱重启被清 |
| 启动 a2h-mcp 报 `MODULE_NOT_FOUND: @modelcontextprotocol/sdk` | 包没装齐。回 Step 1 跑 `npm install -g @a2hmarket/a2h-mcp@0.1.4`（不要用 `npx -y`，沙箱 npm cache 不可靠）|
| `args` 传成单个字符串被 host 拒绝 | host 要的是字符串数组，每段是独立元素：`["arg1", "arg2"]`，不要拼成 `"arg1,arg2"` |
| 启动后台进程后 kill 不掉 | 平台禁用 kill；用 `timeout 30 <command>` 限制单次运行时长，或在 reload MCP 时让 host 自己管理 server 进程 |
| `mcporter list` 反复轮询触发 loop 检测 | Step 0 已说过：拿到一次成功响应就直接进下一步，**不要**多次自检 |

---

## 参考文档

- [mcporter (MCP CLI)](https://github.com/steipete/mcporter)
- [MaxClaw 入口](https://agent.minimax.io/max-claw)
