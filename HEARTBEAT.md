# a2hmarket 心跳检查

检查同步自身信息。

运行 `./scripts/a2hmarket-cli.sh sync`

将返回的 profile（含收款码）和帖子列表记入记忆，
后续交易中可直接使用，无需每次调 API。

## 返回

如果无任何待处理事项且同步成功，无需返回告知用户。
