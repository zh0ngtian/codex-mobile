# 历史消息就地编辑与跨版本更新说明实施计划

> **执行要求：** 当前环境未暴露 superpowers Skill；按仓库既有 superpowers 计划格式执行，并遵循 TDD、系统化调试和完成前验证流程。

**目标：** 将历史消息编辑从底部发送框迁移到原消息气泡内，保持输入法和编辑上下文不被底部弹窗遮挡；固定局域网更新清单持久化版本说明，使跨版本升级能按版本列出当前版本之后的全部更新内容。

**交互基线：** 历史消息点击“编辑”后，原气泡直接切换为文本编辑框，原附件继续显示在同一消息中；保存、取消以及“删除后续并重发”确认都在该消息内完成。底部发送框不承载历史编辑文本，也不丢失已有草稿。

**更新架构：** 固定渠道 `latest.json` 新增向后兼容的 `releases` 数组。发布脚本在每次原子替换清单时保留旧版本说明并去重；客户端兼容没有 `releases` 的旧清单，并只展示大于当前版本且不高于目标版本的条目。

## 任务 1：先写失败的就地编辑交互测试

**文件：**

- 修改 `tests/ui/conversation-page-pagination.test.tsx`
- 修改 `tests/e2e/mobile.spec.ts`

1. 断言历史消息气泡内出现独立文本框、保存和取消操作。
2. 断言底部发送框原草稿保持不变，历史编辑不再渲染底部横幅或 ActionSheet。
3. 断言存在后续对话时，删除提示和确认按钮在目标消息内出现。
4. 先运行聚焦测试，确认旧实现无法满足断言。

## 任务 2：实现消息气泡就地编辑

**文件：**

- 修改 `src/App.tsx`
- 修改 `src/features/conversation/ConversationPage.tsx`
- 修改 `src/features/conversation/Timeline.tsx`
- 修改 `src/styles.css`
- 修改 `src/i18n.tsx`

1. 历史编辑状态独立保存编辑文本，不再替换底部 composer 的草稿和附件。
2. 目标用户气泡切换为内联 textarea，保留原附件展示。
3. 保存、取消和删除后续确认全部在气泡内完成；提交仍执行既有二次状态校验与 revert/rollback。
4. 编辑期间禁用底部发送入口，避免普通发送与历史回退并发；取消或完成后恢复。

## 任务 3：先写失败的跨版本说明测试

**文件：**

- 修改 `tests/ui/app-update-release.test.ts`
- 修改 `tests/ui/app-update-sheet.test.tsx`
- 修改 `/Users/zhongtian/WorkSpace/GlobalTranslation/tests/test_apk_server.py`

1. 断言新旧清单均可解析，新清单按语义版本去重排序。
2. 断言从旧版本升级时只展示升级路径中的全部版本说明。
3. 断言固定渠道连续发布会保留所有版本说明，重复发布同一版本不会重复。
4. 先运行聚焦测试，确认现有单版本实现失败。

## 任务 4：实现清单历史与跨版本展示

**文件：**

- 修改 `src/app-update/release.ts`
- 修改 `src/features/update/AppUpdateSheet.tsx`
- 修改 `src/features/update/useAppUpdate.ts`
- 修改 `src/styles.css`
- 修改 `/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py`

1. 发布脚本从旧清单迁移并维护 `releases` 数组，继续保留原顶层字段供旧客户端使用。
2. 客户端校验、缓存并筛选当前版本之后的说明；旧清单回退为单条目标版本说明。
3. 更新 Sheet 逐版本显示版本号与说明，下载和摘要校验仍只针对最新 APK。
4. 重启本机 APK 服务并验证清单仍可被旧客户端字段解析。

## 任务 5：验证、提交与固定渠道发布

1. 运行聚焦测试、完整 `npm test`、`npm run typecheck`、`npm run build`、服务端 unittest 和 `git diff --check`。
2. 分别在两个仓库按各自规范提交并推送，确保不混入无关改动。
3. 重新读取固定渠道版本，构建版本号更高的新 APK。
4. 使用固定渠道发布命令发布；通过 JSON、HEAD、GET 核对版本、历史说明、大小和 SHA-256。
5. 清理临时构建和验证文件。
