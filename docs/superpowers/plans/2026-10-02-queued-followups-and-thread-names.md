# 排队消息生命周期与会话标题同步实施计划

> **执行要求：** 当前环境未暴露 superpowers Skill；按仓库既有 superpowers 计划格式执行，并遵循 TDD、系统化调试和完成前验证流程。

**目标：** 补全运行中追加消息的编辑、取消和转引导能力；切换会话或新建聊天时按线程保留未发送队列；消费 App Server 的会话名称通知，使移动端标题与其他客户端实时一致。

**交互边界：** 排队消息是当前浏览器进程内状态，不伪装成 App Server 持久化数据。每条队列固定归属于创建时的 `threadId`；离开会话后隐藏但不丢弃，返回原会话时继续展示，并在线程空闲后按原顺序发送。归档仍有队列的会话前必须明确确认，确认并归档成功后才释放附件预览资源。

## 任务 1：先写失败的领域与 UI 测试

**文件：**

- 新增 `tests/ui/queued-follow-ups.test.ts`
- 修改 `tests/ui/conversation-page-pagination.test.tsx`
- 修改 `tests/ui/thread-metadata.test.ts`

1. 覆盖按线程筛选、编辑文本、取消队列和队列存在判断。
2. 断言排队卡片提供编辑、取消和转为引导；编辑保留附件语义且空文本校验正确。
3. 覆盖 `thread/name/updated` 对列表线程和当前线程的不可变更新。
4. 先运行聚焦测试，确认测试因能力缺失而失败。

## 任务 2：实现排队消息状态机

**文件：**

- 新增 `src/app-server/queued-follow-ups.ts`
- 修改 `src/features/conversation/ConversationPage.tsx`
- 修改 `src/App.tsx`
- 修改 `src/styles.css`
- 修改 `src/i18n.tsx`

1. 排队卡片增加就地编辑、保存、取消编辑、取消排队和改为引导操作。
2. 编辑文本时重新解析 Skill 与插件引用，附件继续保留；纯文本队列不允许保存空内容。
3. 取消队列时释放对应文件预览 URL，并保持其他线程队列不变。
4. 自动发送只选择当前线程的首条队列，避免其他线程队列阻塞当前线程。

## 任务 3：实现离开保护与名称同步

**文件：**

- 修改 `src/App.tsx`
- 修改 `src/app-server/thread-metadata.ts`
- 修改对应测试

1. 切换会话和新建聊天只重置草稿上下文，不再清空排队消息。
2. 返回原会话时把该线程队列绑定到新的草稿上下文，确保失败恢复和发送后的资源清理仍然正确。
3. 归档存在排队消息的会话前请求确认；取消归档不改变队列，成功归档后清理该线程队列。
4. 消费 `thread/name/updated { threadId, threadName }`，同步线程列表和当前详情；允许 `null` 清除自定义名称。

## 任务 4：验证、提交与固定渠道发布

1. 运行聚焦测试、完整 `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e` 和 `git diff --check`。
2. 检查差异并只提交本任务文件，使用符合仓库约定的中文 Conventional Commit。
3. 推送当前分支后读取固定渠道版本，构建版本号更高的新 APK。
4. 使用 `apk-server.py publish-channel codex-mobile` 发布；通过固定 JSON、HEAD、GET 核对版本、文件大小和 SHA-256。
5. 清理本次产生且后续无用的临时文件。
