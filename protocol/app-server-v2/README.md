# Codex app-server V2 协议快照

本目录同时保存 OpenAI 官方仓库发布的协议文档、Schema 和权威源定义，以及由
`codex-cli 0.144.1` 生成的历史基准产物。它们不是当前安装 CLI 或上游 main 的实时镜像。

## 项目主基准

项目开发直接使用：

```text
codex_app_server_protocol.v2.schemas.json
```

该文件来自 `codex-cli 0.144.1 --experimental` 的本机生成快照；复核使用本目录已提交文件及下方生成命令，不依赖当时的临时目录。

校验信息：

```text
SHA-256  014585709f6c6a260296453783b4f35b1d1d41923ec51fbe314bd57b832cbe3c
definitions  586
JSON  valid
```

它与 `codex-cli 0.144.1 --experimental` 生成的本地 Schema 在规范化 JSON
语义上完全一致，原始文件的差异仅为对象键顺序或格式。因此第一版客户端以这份
Schema 为协议基准。

## 官方快照

来源：

- 仓库：`https://github.com/openai/codex`
- 分支：`main`
- 提交：`322d5b96cfa5c8fd52bd83ecfdb79cd9b330205f`
- 拉取日期：`2026-07-26`

主要入口：

- `official/codex-rs/app-server/README.md`
  - 官方 app-server 协议文档、生命周期、方法、事件和审批流程。
- `official/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.v2.schemas.json`
  - 官方仓库提交的 V2 JSON Schema bundle。
- `official/codex-rs/app-server-protocol/schema/json/v2/`
  - 按类型拆分的 V2 JSON Schema。
- `official/codex-rs/app-server-protocol/src/protocol/common.rs`
  - 通用请求、响应、通知和协议注册定义。
- `official/codex-rs/app-server-protocol/src/protocol/v2/`
  - V2 协议的权威 Rust 类型定义。

官方 V2 Schema bundle 的 SHA-256：

```text
380e97f5778c40c7fead146c6af5da97e478164b194c0ce1b15edac80d8c8527
```

## 本机生成快照

目录：

```text
generated-local/codex-cli-0.144.1/
├── schema/
└── typescript/
```

生成环境：

```text
codex-cli 0.144.1
```

生成命令：

```bash
codex app-server generate-ts \
  --experimental \
  --out protocol/app-server-v2/generated-local/codex-cli-0.144.1/typescript

codex app-server generate-json-schema \
  --experimental \
  --out protocol/app-server-v2/generated-local/codex-cli-0.144.1/schema
```

## 使用原则

- 阅读协议行为、调用顺序和 UI 建议时，以官方 `app-server/README.md` 为准。
- `official/codex-rs/app-server-protocol/src/protocol/{common.rs,v2}/` 对应上述固定提交的类型定义；跟踪上游变化需要另行获取并比较新快照，不能把已提交副本当作当前 main。
- 构建当前机器上的客户端时，以对应 CLI 版本生成的 TypeScript 和 JSON Schema
  为准，因为官方文档明确说明生成产物与运行生成命令的 Codex 版本严格匹配。
- 本目录的 `codex_app_server_protocol.v2.schemas.json` 用于 `tests/protocol/schema.test.ts` 协议基准检查；审批模型也引用 `generated-local/` 中的类型。实际可用能力还要以连接的 app-server 响应和客户端兼容逻辑为准；`official/` 仅用于对照所记录提交。
- `--experimental` 生成的字段和方法需要客户端在 `initialize` 中设置
  `capabilities.experimentalApi: true`。
- Schema 不用于生成第二套会话历史。网关还负责 HTTP 会话、写入去重、事件及回合详情精简等适配，并非所有消息都原样透传；当前职责见 [系统架构](../../README.md#系统架构)。
