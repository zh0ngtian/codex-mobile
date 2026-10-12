# 回退逐文件统计展示

> 执行：superpowers:executing-plans 在独立 worktree 逐项完成，遵循 TDD；固定渠道发布持锁串行。

**目标：** 对话恢复原来的工具活动显示方式，只展示总改动；用户主动进入 Diff 详情时保留原有文件查看能力。

**架构：** 定向删除 FileChangeActivity 与其样式；ToolActivity 恢复统一活动列表。移除本次逐文件卡片引入的 initialFileIndex 参数。保留后续阶段展示、过程折叠和会话回填改动。

- [x] 基线：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/conversation.test.tsx tests/ui/tool-sheets.test.tsx`。
- [x] 修改现有逐文件回归，断言展开过程后仍无逐文件卡片、总数正确；先确认旧实现失败。
- [x] 回退 Timeline、ToolSheets 与相关 CSS；浏览器验收改为只显示总数，主动点击原活动仍可进入 Diff。
- [x] 运行相关 Vitest、`npm run build` 和专项 Playwright；`git diff --check`。
- [ ] 持有主工作区固定渠道锁，读取在线版本并分配更高版本；提交推送 main，使用自动双端构建及本机 `ios:release`。
- [ ] 固定 APK、IPA、HTTPS OTA 清单/HEAD/完整 GET 验证；软件源只核对 unsigned IPA 订阅版本，不上传签名包。
- [ ] 保留正式签名包与 ota-release.json，记录交付，清理临时资源并归档 worktree。

## 本地验证

- 现有用例先红后绿，84 个相关 Vitest 用例通过。
- `npm run build` 与专项 Playwright（1 个）通过，375×812 截图确认只显示总改动且无横向溢出。
- 持锁核对双端渠道均为 0.2.162，下一版分配 0.2.163；iOS 发布预检通过，升级身份保持连续。

## 构建阻塞修复

- 首次双端 CI 与本机准备均失败：`pnpm@10` 解析到 10.34.7，其 npm tarball 返回 404；10.34.6 的 tarball 返回 200。
- 先增加双端/本机精确版本一致性回归并确认失败，再将 workflow、双端 recipe 和本机准备入口统一固定 10.34.6，避免自动解析到不可下载版本。
