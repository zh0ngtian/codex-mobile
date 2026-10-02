# 统一会话搜索与断线对账实施计划

> **执行要求：** 按仓库既有 superpowers 计划格式执行，并遵循 TDD、系统化调试和完成前验证流程。

**目标：** 使用 App Server 的统一全文会话搜索替换仅过滤已加载列表的搜索逻辑；搜索标题、可见消息、设备和项目时只展示一个合并结果列表；前后台恢复与断线重连时重新对账会话列表和当前会话，且不因传输断开把服务端任务判为已停止。

**事实边界：** 会话 ID、名称、历史、全文匹配片段和运行状态以 App Server 为准。移动端只叠加未读、折叠等展示状态，不持久化搜索索引或会话历史。搜索排除临时线程和派生子线程。

## 任务 1：先写失败的搜索协议与展示测试

**文件：**

- 新增 `tests/ui/thread-search.test.ts`
- 修改 `tests/ui/thread-list-model.test.ts`
- 修改 `tests/ui/thread-list-page.test.tsx`

1. 覆盖 `thread/search` 分页、全文片段、去重和临时/子线程过滤。
2. 覆盖旧 App Server 不支持 `thread/search` 时回退 `thread/list(searchTerm)`。
3. 覆盖服务端全文结果与现有标题、设备、项目匹配结果合并且不重复。
4. 覆盖同一个搜索框内展示全文命中片段和搜索中状态。
5. 先运行聚焦测试，确认能力缺失导致失败。

## 任务 2：实现统一搜索数据流

**文件：**

- 新增 `src/app-server/thread-search.ts`
- 修改 `src/App.tsx`
- 修改 `src/features/threads/thread-list-model.ts`
- 修改 `src/features/threads/ThreadListPage.tsx`
- 修改 `src/i18n.tsx`
- 修改 `src/styles.css`

1. 每台在线设备对非空查询调用 App Server `thread/search`，沿游标读取全部结果。
2. 将服务端全文结果与当前标题、设备和项目元数据匹配合并为一个结果列表。
3. 搜索结果使用服务端 thread 记录和 snippet，不写入本地持久化索引。
4. 查询防抖并忽略旧查询迟到结果；搜索失败不破坏普通会话列表。
5. App Server 不支持统一搜索时降级为服务端标题搜索，并保留现有元数据过滤。

## 任务 3：补全连接恢复对账

**文件：**

- 修改 `src/backends/connection-recovery.ts`
- 修改 `src/App.tsx`
- 修改 `tests/ui/connection-recovery.test.ts`

1. 健康连接回到前台时同时刷新服务端会话列表和当前会话快照。
2. 两项对账彼此独立启动，单项失败不阻止另一项读取。
3. WebSocket 离线只清理失效请求句柄，不把正在运行的服务端 turn 直接标记为空闲。
4. 重连初始化继续通过 `thread/resume` 恢复设置、历史和真实运行状态。

## 任务 4：验证、提交与固定渠道发布

1. 运行聚焦测试、完整 `npm test`、`npm run typecheck`、`npm run build`、相关 E2E 和 `git diff --check`。
2. 检查差异并只提交本任务文件，使用符合仓库约定的中文 Conventional Commit。
3. 推送 `main` 后读取固定渠道版本，构建并发布更高版本 APK。
4. 通过固定 JSON、HEAD 和 GET 核对版本、文件大小、SHA-256 与构建产物一致。
5. 清理生成的协议 schema、APK 下载副本和其他临时文件。
