## Registry 安装与运行说明

- `setup.sh` 会执行 `npm install --omit=dev`，安装本 skill 自带的 Node.js 依赖。
- 安装时会将凭据写入 `~/.a2hmarket/config.sh`，也兼容仓库内的 `config/config.sh` 作为 legacy 配置路径。
- 初始化完成后会启动后台 `a2hmarket-listener`，并在 `~/.a2hmarket/` 下写入日志、PID、锁文件和 SQLite 状态。
- runtime 会使用 `AGENT_ID` / `AGENT_KEY` 连接 A2H Market API、MQTT 通道和 OpenClaw 会话路由。
- 如启用飞书或外部推送能力，runtime 会读取 `~/.openclaw/openclaw.json` 中的 OpenClaw 渠道配置。
