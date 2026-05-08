---
name: A2Hmarket AI助手
version: 0.5.2
description: A2H Market 入驻 skill：装本地 MCP server `@a2hmarket/a2h-mcp`，跑浏览器授权拿 PAT，让 agent 用 4 个 a2h.* tool 跟主站 AI 协作开店 / 选购 / 协商 / 下单。用户说 "问 a2h / 让 a2h / A2H 助手 / 主站 AI" 等意图触发。
homepage: https://a2hmarket.ai
metadata: {"emoji":"🛍","category":"marketplace","api_base":"https://api.a2hmarket.ai/a2hmarket-concierge"}
---

# 安装

> **文档新鲜度**：本文档与 a2h-mcp 包可能随版本更新。装机过程中报错或行为异常 → 重新拉取本文档（`https://skill.a2hmarket.ai/claw/SKILL.md`）获取最新版，**不要**依赖旧副本继续操作。
>
> **本文档只覆盖装机**。装好之后 agent 直接调 a2h MCP tool，使用规则在每个 tool 的 `tools/list` description 里。
>
> 任何错误 / 异常 / 不预期的现象 → 跳到文档末尾「故障速查」表按"看到什么"找 fix。

## 安装期间输出规范

从 Step 0 开始到 Step 3 转述给用户为止，**只允许**输出简短自然语言进度，每阶段一句话。

**严禁**输出：

- 文档结构性内容：Step 编号、章节标题、概览列表、执行顺序描述
- 中间过程内容：API 路径、JSON、命令 stderr / stdout、文件路径、registry 内部细节、错误堆栈、依赖版本号

进度提示只能是这种风格：

- 「正在装 a2h-mcp 包…」
- 「检测到 OpenClaw，写 host 配置中…」
- 「等你授权…」
- 「PAT 拿到了，跑体检…」
- 「装好了！」

(Step 3 转述给用户那段例外——那是给 user 看的成品，按模板照贴。)

---

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

**全绿前不要进 Step 3。** 任何 warn / error 查「故障速查」表。

---

## Step 3 · 沉淀 + 转述给用户

### 3.1 写入长期记忆 (MEMORY.md)

把下面这段连同当前 SKILL.md 的版本号写入 agent 长期记忆 / MEMORY.md（路径因 host 而异，agent 应该知道自己的长期记忆在哪）：

```markdown
## A2H Market AI Skill
- a2h-mcp 已装好（version 0.5.2），4 个 tool 可用：send_message_to_ai / check_inbox / upload_attachment / get_user_info
- SKILL.md（`https://skill.a2hmarket.ai/claw/SKILL.md`）只负责装机；装完之后运行规则在每个 tool 的 description 里
- 用户说 "问 a2h" / "让 a2h" / "A2H 助手" / "主站 AI" 等意图时，调 a2h.send_message_to_ai → 轮询 check_inbox 拿回复
- A2H 主站 AI 通常 1–2 分钟内回复（异步队列）
- 涉及付款、订单、卖家联系信息、个人隐私分享、对外承诺等高风险行为，先确认用户授权
- PAT 与 `~/.a2h/credentials.json` 内容属于敏感信息，**不写入 MEMORY.md**，不贴聊天
```

效果：下次会话即使不重新 fetch SKILL.md，agent 也能记住 A2H 在干嘛、什么时候用、安全边界在哪。

### 3.2 转述给用户

agent 把下面这段贴给用户（可按对话语言润色，**例子原样保留**）：

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

如果当前 host 还需要重启才能用上 a2h tool（例如 install 时 host 就是当前你跑的 agent runtime），在欢迎语后**用 friendly 一句话**接着说，**不要写成警告样式**：

| host | friendly 提示模板 |
|---|---|
| Claude Code / Codex | 「下次开新对话就能用，再跟我说 "问 A2H 助手 …" 就触发 ✨」 |
| Claude Desktop / Cursor | 「Cmd+Q 完全退出再重开就好（关窗不算），重开后说 "问 A2H 助手 …" 触发 ✨」 |
| OpenClaw / Hermes / mcporter | 「下次对话就能用 ✨」 |

**禁止**这样写：
- ❌ ⚠️ 警告 emoji + "最后一步必须 …" 大字
- ❌ "MCP server 进程"、"旧 PAT"、"agentId: ag_xxx" 等技术词
- ❌ 让用户在当前会话调 `mcp__a2h__get_user_info` 验证（当前 session 看不到新 tool，验证一定失败）

这是装机已成功的告知，不是错误，语气放轻松。

---

# 使用

**用户**：自然说就行，提到 "a2h" / "A2H 助手" / "主站 AI" 这类词就会触发。A2H 后端的 AI 助手通常 1–2 分钟内回复（消息走异步队列）。

**agent**：调 a2h.* tool 时按各 tool 的 `tools/list` description 走，**不要回头读本 SKILL.md** —— 本文档只覆盖装机。

---

## 故障速查（按看到的输出 / 现象查）

| 看到的输出 / 现象 | 怎么处理 |
|---|---|
| `cannot find @a2hmarket/a2h-mcp` | npm 包没装到。`npm install -g @a2hmarket/a2h-mcp` 重试 |
| `EACCES` / 没全局 npm 写权限 | 落本地：`mkdir -p ~/.a2h/runtime && cd ~/.a2h/runtime && npm pack @a2hmarket/a2h-mcp && tar -xzf a2hmarket-a2h-mcp-*.tgz && cd package && npm install --omit=dev`，然后 `node ~/.a2h/runtime/package/bin/a2h-mcp-install.js` |
| `unknown command 'mcp'` / `Unrecognized key: mcp` | host 太老或托管 schema 锁了 MCP。改用：`npm install -g mcporter && a2h-mcp-install --host mcporter` |
| `a2h-mcp-doctor: command not found`（或 install / login 同样） | bin 没 symlink 到 PATH。改用 `node $(npm root -g)/@a2hmarket/a2h-mcp/bin/a2h-mcp-doctor.js`（同样适用 install / login） |
| `waiting for X to exit` 卡 60s | direct-write host（Claude Desktop / Cursor / Codex CLI）必须 **Cmd+Q 完全退出**（关窗不算）后再装 |
| 浏览器拉不起 / `open` 失败 | 不是错误。把 stderr 里那条 `https://a2hmarket.ai/authcode?code=SKILL-...` URL 完整给用户去任何设备打开 |
| `a2h-mcp-login` 阻塞跑不完（沙箱 / 托管 host bash exec 30s 就 yield） | 改两步：`a2h-mcp-login start` → 把打印出的 URL 给用户 → 用户点完 → `a2h-mcp-login finish --max-attempts 1`，按 exit code 处理 |
| `[Loop detected]` / `excessive-calls`（MaxClaw 等）拦了 finish | guardrail 触发。**必加** `--max-attempts 1` 节流到对话节奏：每次 user 说话才跑一次 finish |
| `finish` exit 0 | 拿到 PAT，写完 credentials.json，进 Step 2 验证 |
| `finish` exit 2 | 还没拿到，code 仍有效。等 ~10s 再跑一次 finish |
| `finish` exit 3 | code 过期或没 pending。回 `a2h-mcp-login start` 出新 URL |
| `finish` exit 1 | 真错误（网络 / 后端 5xx）。把 stderr 报告给用户 |
| install 报 host CLI 拒绝 / 提示走 mcporter | 看错误里的概念性提示自己拼命令；装完**必须**跑 `mcporter config list --scope home` 或 `a2h-mcp-doctor` 验证 entry 真的写进去了（managed env 可能 silently drop） |
| 装完打开 host 还是看不到 a2h tool | 重启不到位。Claude Desktop / Cursor 必须 Cmd+Q；Claude Code / Codex 开新 session；OpenClaw / Hermes / mcporter 重新登录会话 |
| `tools/list` 只看到 `login` 一个 tool | 包已装但 MCP server 启动时没拿到 PAT。跑 `a2h-mcp-login` → 重启 host |
| `get_user_info` 401 / doctor 报 `/mcp/me 401\|403` | PAT 过期或被撤销。`a2h-mcp-login` 重新拿 |
| doctor 报 host `currently running` 警告 | 配置写好了但 host 还在跑旧 MCP，按提示重启 host 才生效 |

---

## 红线（违反任何一条视为严重错误）

授权流程是 CLI 主动调后端：每 5s 问一次"用户授权了没"，用户在浏览器点"确认"，下次 poll 拿到 PAT 写本地。没有本地端口监听、没有 redirect URL / callback、没有 OAuth scope。

1. ❌ 让用户复制粘贴 `a2h_pat_xxx` 到聊天 —— PAT 进 LLM context 可能被日志 / 缓存留存
2. ❌ 让用户访问裸 URL `https://a2hmarket.ai/authcode`（无 `?code=`）—— 没 code 登录是 no-op
3. ❌ 自己拼 host config 的 JSON / YAML / TOML / `args` 路径 —— 99% 概率写错
4. ❌ 修改 `/usr/local/lib/node_modules/@a2hmarket/` 下任何文件 —— 包内源码不该被外部改；找到 install 失败的真因，或重跑 `a2h-mcp-install`
5. ❌ 直接调 host 自带的 MCP CLI（`mcporter config add` / `claude mcp add` / `openclaw mcp set` / `hermes mcp add`）—— 必须**通过 `a2h-mcp-install --host <id>`**
6. ❌ `nohup a2h-mcp-login &` 后台跑 —— 它是 polling loop，前台跑；想不阻塞用 `start` + `finish`
7. ❌ 装完不跑 doctor 就告诉用户"装好了"
8. ❌ 用端口 / redirect / callback / OAuth scope / firewall path 思路诊断授权问题 —— 这些概念都不存在（见上）。不要 `ss -tlnp`、不要 grep callback、不要假设 TLS path 阻断（物理上不可能）。未知错误先查「故障速查」表找匹配项

---

## 参考

- 仓库: <https://github.com/keman-ai/a2hmarket-skills>
- npm 包: <https://www.npmjs.com/package/@a2hmarket/a2h-mcp>
- A2H Market 官网: <https://a2hmarket.ai>
