# Fast 冷启动恢复修复计划

**Goal:** 模型目录延迟返回时，已有会话的 Fast 不再被错误清除。

**Architecture:** 会话恢复需要保留服务端速度原值直到模型目录就绪；界面只展示已经被模型目录验证的速度。目录返回后用现有归一化流程将原值转换为规范 tier，并保持任务发送参数一致。

**Tech Stack:** React、TypeScript、Vitest、Playwright、Android APK。

## 任务 1：复现与修复

- [ ] 修改 `tests/e2e/model-settings-persistence.spec.ts`：控制模型目录返回时机，分别恢复 `priority`、`fast`、`null`，目录返回后检查速度菜单与图标；重载后重复打开，发送请求应保留对应速度。
- [ ] 运行 `npm run build` 和定向 Playwright，确认原实现把 Fast 错误恢复成正常。
- [ ] 在 `tests/ui/settings.test.ts` 增加 `normalizeModelSettings(null, "high", "priority")` 返回 `serviceTier: "priority"` 的断言，确认失败。
- [ ] 修改 `src/ui/settings.ts`：没有模型元数据时保留非默认的原始速度值；`normal`、`default`、空值保持正常。
- [ ] 修改 `src/App.tsx`：只有存在模型目录项时才展示已归一化速度，避免原始占位值被误显示成闪电。
- [ ] 运行模型设置单元、端到端回归与构建检查。

## 任务 2：交付

- [ ] 阅读提交约定，提升版本下限到高于固定渠道的版本，提交并推送。
- [ ] 构建 APK，安装到 LGE-AN10 并检查冷启动后的 Fast 菜单与图标。
- [ ] 发布固定渠道，检查 JSON、HEAD、GET 的版本、大小和 SHA-256；清理临时文件。
