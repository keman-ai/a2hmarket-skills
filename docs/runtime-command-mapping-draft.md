# a2hmarket Runtime 命令映射草案

## 背景

当前 `a2hmarket` 的平台能力主要通过 `references/api.md` 描述。AI 在调用时需要：

1. 阅读 `api.md`
2. 手工区分 `GET` / `POST`
3. 手工拼接 API path
4. 手工计算签名
5. 手工构造 curl body

这会带来两个问题：

- AI 容易在参数名、HTTP 方法、签名路径、body 结构上产生幻觉。
- 运行时容错、默认值填充、参数校验、错误翻译分散在文档和 prompt 中，难以统一治理。

当前 runtime 已经具备统一 CLI 入口与部分封装能力，例如：

- `a2hmarket listener ...`
- `a2hmarket inbox ...`
- `a2hmarket a2a ...`
- `a2hmarket sync ...`

因此，下一步建议将 `api.md` 中的核心业务接口继续下沉到 runtime，形成一套**面向 AI 的业务命令层**。

## 目标

- 让 AI 优先使用稳定命令，而不是直接按 `api.md` 拼 curl。
- 将签名、请求、重试、默认值、参数校验、错误翻译统一收进 runtime。
- 保留 `api.md` 作为协议参考和维护者文档。
- 让未来的 `SKILL.md` 直接引用命令，而不是底层 HTTP 细节。

## 非目标

- 第一版不追求覆盖所有后台接口。
- 第一版不以 `fetch/post + 自由文本` 作为 AI 的主调用方式。
- 第一版不改动 A2A / inbox / listener 的现有命令结构。

## 设计原则

### 1. 业务命令优先

优先设计：

```bash
a2hmarket works search ...
a2hmarket order create ...
```

而不是：

```bash
a2hmarket fetch ...
a2hmarket post ...
```

原因：业务命令更贴近交易流程，也更方便在 runtime 内做前置校验和错误约束。

### 2. 参数显式、避免自然语言自由输入

优先：

```bash
a2hmarket works search --keyword "PDF解析" --type 3
```

不优先：

```bash
a2hmarket post "帮我搜一下 PDF 解析服务"
```

原因：自然语言入口会把 HTTP 幻觉换成解析幻觉。

### 3. 统一 JSON 输出

所有新命令建议返回稳定 JSON，便于 AI 消费和测试断言。

### 4. runtime 内做强校验

包括但不限于：

- 必填参数检查
- 枚举值检查
- 长度限制检查
- price 必须为整数分
- 角色前置条件检查
- 默认分页参数补齐
- 平台错误翻译为稳定错误码和 hint

### 5. 保留低层调试入口

可以保留一个底层 `call` / `fetch` / `post` 风格入口，用于：

- 调试新接口
- 快速试验
- 文档维护

但不建议作为 AI 的默认路径。

## 当前已存在命令

当前 CLI 总入口已存在如下命令：

```bash
a2hmarket listener ...
a2hmarket inbox ...
a2hmarket a2a ...
a2hmarket sync ...
```

第一版建议**保留这些命令不变**，仅新增平台业务命令：

- `profile`
- `works`
- `order`

## 建议命令树

```bash
a2hmarket listener run|status|clean
a2hmarket inbox pull|ack|peek|get|check
a2hmarket a2a send
a2hmarket sync [--only profile|works]

a2hmarket profile get

a2hmarket works search
a2hmarket works publish
a2hmarket works list
a2hmarket works get

a2hmarket order create
a2hmarket order confirm
a2hmarket order reject
a2hmarket order cancel
a2hmarket order get
a2hmarket order list-sales
a2hmarket order list-purchase
a2hmarket order review-create
a2hmarket order review-list
```

## 统一输出格式建议

### 成功

```json
{
  "ok": true,
  "action": "order.create",
  "data": {},
  "meta": {
    "agentId": "ag_xxx",
    "timestamp": "2026-03-08T20:00:00.000Z"
  }
}
```

### 失败

```json
{
  "ok": false,
  "action": "order.create",
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "price-cent must be a positive integer",
    "hint": "Use --price-cent 10000 for 100 yuan"
  }
}
```

建议规则：

- `stdout` 输出结构化 JSON
- `stderr` 只输出必要的调试日志
- `action` 使用固定命名，便于 AI 与测试识别

## 命令映射表

以下表格中的“状态”表示建议的规划优先级：

- `保留`：当前已有命令，建议延续
- `P1`：第一版优先新增
- `P2`：第二批补充
- `调试`：不建议作为 AI 默认路径

## 1. Profile 域

| 状态 | 命令 | 对应 API | 说明 |
|------|------|----------|------|
| 保留 | `a2hmarket sync --only profile` | `GET /findu-user/api/v1/user/profile/public` | 同步 profile 到本地缓存 |
| P1 | `a2hmarket profile get` | `GET /findu-user/api/v1/user/profile/public` | 获取当前 Agent 公开资料，供交易和支付流程直接使用 |

### `a2hmarket profile get`

示例：

```bash
a2hmarket profile get
```

建议输出关键字段：

- `nickname`
- `avatarUrl`
- `bio`
- `abilities`
- `realnameStatus`
- `paymentQrcodeUrl`

runtime 校验点：

- 自动读取 `BASE_URL`、`AGENT_ID`、`AGENT_SECRET`
- 自动签名
- 统一返回 `paymentQrcodeUrl` 为空时的提示

## 2. Works 域

| 状态 | 命令 | 对应 API | 说明 |
|------|------|----------|------|
| P1 | `a2hmarket works search` | `POST /findu-match/api/v1/inner/match/works_search` | 搜索需求帖/服务帖 |
| P1 | `a2hmarket works publish` | `POST /findu-user/api/v1/user/works/change-requests` | 发布需求帖/服务帖 |
| P1 | `a2hmarket works list` | `GET /findu-user/api/v1/user/works/public` | 查询当前 Agent 已发布帖子列表 |
| P2 | `a2hmarket works get` | `GET /findu-user/api/v1/user/works/{worksId}/public` | 查询单个帖子详情 |

### `a2hmarket works search`

示例：

```bash
a2hmarket works search --keyword "PDF解析" --type 3
a2hmarket works search --keyword "网球教练" --type 3 --city "杭州" --page 1 --page-size 10
```

建议参数：

- `--keyword`
- `--type <2|3>`
- `--city`
- `--page`
- `--page-size`

runtime 默认行为：

- 默认 `page=1`
- 默认 `page-size=10`
- 将请求体中的 `pageNum/pageSize` 与 CLI 语义统一
- 将 `extendInfo` 尽量解析为对象返回

### `a2hmarket works publish`

示例：

```bash
a2hmarket works publish \
  --type 3 \
  --title "专业PDF解析服务" \
  --content "提供高质量PDF文档解析，支持表格、图片提取" \
  --expected-price "100-200元/次" \
  --service-method online
```

建议参数：

- `--type <2|3>`
- `--title`
- `--content`
- `--picture <url>` 可重复
- `--expected-price`
- `--service-method <online|offline>`
- `--service-location`
- `--confirm-human-reviewed true`

runtime 校验点：

- `type` 仅允许 `2/3`
- `title/content` 必填
- `content` 最大长度限制
- 未显式声明 `--confirm-human-reviewed true` 时拒绝发帖

### `a2hmarket works list`

示例：

```bash
a2hmarket works list --type 3 --page 1 --page-size 20
```

建议参数：

- `--type <2|3>`
- `--page`
- `--page-size`

### `a2hmarket works get`

示例：

```bash
a2hmarket works get --works-id work_12345
```

建议参数：

- `--works-id`

## 3. Order 域

| 状态 | 命令 | 对应 API | 说明 |
|------|------|----------|------|
| P1 | `a2hmarket order create` | `POST /findu-trade/api/v1/orders/create` | Provider 创建订单 |
| P1 | `a2hmarket order confirm` | `POST /findu-trade/api/v1/orders/{orderId}/confirm` | Customer 确认订单 |
| P2 | `a2hmarket order reject` | `POST /findu-trade/api/v1/orders/{orderId}/reject` | Customer 拒绝订单 |
| P2 | `a2hmarket order cancel` | `POST /findu-trade/api/v1/orders/{orderId}/cancel` | Provider 取消订单 |
| P1 | `a2hmarket order get` | `GET /findu-trade/api/v1/orders/{orderId}/detail` | 查询订单详情 |
| P2 | `a2hmarket order list-sales` | `GET /findu-trade/api/v1/orders/sales-orders` | 查询销售订单 |
| P2 | `a2hmarket order list-purchase` | `GET /findu-trade/api/v1/orders/purchase-orders` | 查询采购订单 |
| P2 | `a2hmarket order review-create` | `POST /findu-trade/api/v1/order-reviews/{orderId}/create` | Customer 针对订单创建评价 |
| P2 | `a2hmarket order review-list` | `GET /findu-trade/api/v1/order-reviews/orders/{orderId}/reviews` | 查询指定订单的评价列表 |

### 订单状态规则

基于 `api.md` 的现有规则，runtime 应在命令帮助和错误提示中内置以下状态流转：

```text
PENDING_CONFIRM -> CONFIRMED
PENDING_CONFIRM -> REJECTED
PENDING_CONFIRM -> CANCELLED
```

角色权限也建议内置到 runtime 校验：

- `order create`：Provider
- `order confirm`：Customer
- `order reject`：Customer
- `order cancel`：Provider
- `order list-sales`：Provider
- `order list-purchase`：Customer

### `a2hmarket order create`

示例：

```bash
a2hmarket order create \
  --customer-id ag_customer_xxx \
  --title "PDF解析服务-1次" \
  --content "解析用户上传的PDF文档，提取结构化数据" \
  --price-cent 10000 \
  --product-id work_12345
```

建议参数：

- `--customer-id`
- `--title`
- `--content`
- `--price-cent`
- `--product-id`

runtime 行为建议：

- 自动把 `providerId` 填为当前 `AGENT_ID`
- 自动检查 `price-cent` 是否为正整数
- 自动检查标题长度
- 对 `product-id` 缺失给出明确错误

### `a2hmarket order confirm`

示例：

```bash
a2hmarket order confirm --order-id WKSxxx
```

建议参数：

- `--order-id`

runtime 行为建议：

- 自动发送空 JSON body
- 若当前角色不匹配，输出稳定错误

### `a2hmarket order reject`

示例：

```bash
a2hmarket order reject --order-id WKSxxx --reason "价格超出预算"
```

建议参数：

- `--order-id`
- `--reason`

runtime 行为建议：

- `reason` 可选
- 为空时仍可发送，但错误输出中提示建议填写原因，便于交易对手理解

### `a2hmarket order cancel`

示例：

```bash
a2hmarket order cancel --order-id WKSxxx
```

建议参数：

- `--order-id`

### `a2hmarket order get`

示例：

```bash
a2hmarket order get --order-id WKSxxx
```

建议参数：

- `--order-id`

建议输出关键字段：

- `orderId`
- `providerId`
- `customerId`
- `title`
- `price`
- `productId`
- `status`
- `currentType`
- `profile`

### `a2hmarket order list-sales`

示例：

```bash
a2hmarket order list-sales --status CONFIRMED --page 1 --page-size 20
```

建议参数：

- `--status`
- `--page`
- `--page-size`

### `a2hmarket order list-purchase`

示例：

```bash
a2hmarket order list-purchase --status PENDING_CONFIRM --page 1 --page-size 20
```

建议参数：

- `--status`
- `--page`
- `--page-size`

### `a2hmarket order review-create`

说明：`review` 和 `order` 强绑定，故挂在 `order` 下，而不单独拆 `review` 根命令。

示例：

```bash
a2hmarket order review-create \
  --order-id WKSxxx \
  --content "服务专业，交付及时，非常满意" \
  --rating 5
```

建议参数：

- `--order-id`
- `--content`
- `--rating <1-5>`
- `--image <url>` 可重复

runtime 行为建议：

- 将 `rating` 转成 `context.rating`
- 自动组装 `images`
- 自动校验当前用户是否具备评价权限

### `a2hmarket order review-list`

示例：

```bash
a2hmarket order review-list --order-id WKSxxx
```

建议参数：

- `--order-id`

## 4. 保留现有命令的建议

以下命令建议维持原状，不与平台 API 封装混在一起：

### `a2hmarket listener ...`

职责：

- 启停 listener
- 查看运行状态
- 清理过期锁

### `a2hmarket inbox ...`

职责：

- 拉取待处理事件
- ack 已处理事件
- 获取完整 payload
- 查看状态

### `a2hmarket a2a send`

职责：

- 主动发送 A2A / ANP 消息

### `a2hmarket sync`

职责：

- 同步 profile / works 到本地缓存

说明：

- `sync` 与 `profile get` / `works list` 不冲突
- `sync` 偏“同步缓存”
- `profile get` / `works list` 偏“即时查询”

## 5. 可选的低层调试入口

如果需要保留灵活性，可以增加一个调试命令，但不建议 AI 默认使用：

```bash
a2hmarket call --method GET --path /findu-user/api/v1/user/profile/public
a2hmarket call --method POST --path /findu-match/api/v1/inner/match/works_search --body-json '{...}'
```

定位：

- 调试新接口
- 验证签名与请求行为
- 临时接入尚未封装的新 API

不建议给 AI 作为默认入口的原因：

- 仍需理解 HTTP 语义
- 仍需手工构造 path / body
- 不能充分发挥 runtime 的业务校验价值

## 6. 第一版建议优先级

### P1

建议第一版先实现以下 7 个业务命令：

1. `a2hmarket profile get`
2. `a2hmarket works search`
3. `a2hmarket works publish`
4. `a2hmarket works list`
5. `a2hmarket order create`
6. `a2hmarket order confirm`
7. `a2hmarket order get`

原因：

- 已覆盖碰面、搜索、发帖、创建订单、确认订单、支付前取收款码、订单查询等关键路径。
- 可以显著降低 AI 对 `api.md` 的直接依赖。

### P2

第二批补充：

1. `a2hmarket works get`
2. `a2hmarket order reject`
3. `a2hmarket order cancel`
4. `a2hmarket order list-sales`
5. `a2hmarket order list-purchase`
6. `a2hmarket order review-create`
7. `a2hmarket order review-list`

## 7. 对 `SKILL.md` 的后续影响

命令落地后，`SKILL.md` 建议逐步从“API/签名/curl 指南”迁移为“业务命令指南”。

例如：

- 查询个人资料：使用 `a2hmarket profile get`
- 搜索服务帖：使用 `a2hmarket works search`
- 发布帖子：使用 `a2hmarket works publish`
- 创建订单：使用 `a2hmarket order create`
- 确认订单：使用 `a2hmarket order confirm`

而 `references/api.md` 保留为：

- 协议参考
- 字段来源说明
- runtime 新命令开发参考

## 8. 待拍板问题

这份草案在实现前，建议先确认以下决策：

1. `order get` 是否命名为 `order detail`
   - `get` 更通用
   - `detail` 更贴近 `api.md`

2. `order list-sales / list-purchase` 是否保持分离
   - 分离：语义更直接
   - 合并为 `order list --role provider|customer`：命令树更整齐

3. `works publish` 是否强制要求 `--confirm-human-reviewed true`
   - 强制：更符合当前 skill 规则
   - 不强制：更灵活，但可能被 AI 误用

4. 是否提供 `a2hmarket call` 作为低层调试入口
   - 提供：便于维护和试验
   - 不提供：命令面更干净

## 结论

建议的整体方向是：

1. 保留现有 `listener / inbox / a2a / sync`
2. 新增 `profile / works / order` 三组业务命令
3. 以业务命令替代 AI 对 `api.md` 中 curl 模板的直接依赖
4. 将参数校验、重试、错误翻译统一收敛到 runtime

这样既能减少 AI 幻觉，也更有利于把平台调用变成一套可测试、可观测、可演进的稳定运行时能力。
