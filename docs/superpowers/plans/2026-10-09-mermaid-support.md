# Mermaid 支持修复计划

> **执行方式：** 当前会话按 superpowers:executing-plans 与 test-driven-development 逐项执行；用户已授权修复，仓库要求提交、推送并发布固定 APK 渠道。

**目标：** 会话消息和远程 Markdown 预览中的 Mermaid 代码块显示为图表，源码可查看、复制；未完成或错误语法保留源码，不影响会话。

**架构：** 在共享 `MarkdownMessage` 的块级代码入口识别 `language-mermaid`。独立组件延迟加载本地 Mermaid 依赖并防抖渲染，使用 strict 配置和独立临时容器；源文本变化和卸载使过期结果失效。图表宽度限制在消息内，可横向滚动。

**技术栈：** React、react-markdown、Mermaid、Vitest、Playwright、Android WebView。

### 任务 1：复现与回归测试

- [x] 新建 `tests/ui/mermaid.test.tsx`，通过真实 Markdown 入口断言图表出现、复制源码、源码切换、普通代码不受影响、错误回退、流式更新不被旧结果覆盖、卸载清理。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/mermaid.test.tsx`，确认因缺少 Mermaid 图表而失败。

### 任务 2：接入渲染

- [x] `package.json` / `package-lock.json` 纳入 Mermaid 本地依赖，不依赖外部 CDN。
- [x] 新建 `src/ui/mermaid.tsx` 和 `src/ui/mermaid.css`，实现按需加载、150ms 防抖、源码关联结果、过期结果忽略、临时容器 finally 清理及错误源码回退。
- [x] `src/ui/conversation.tsx` 仅在块级代码为 Mermaid 时调用新组件；继续复用 `CopyButton` 和 i18n。
- [x] `src/i18n.tsx` 补齐图表名称和错误提示的英文文案。
- [x] 重跑 Mermaid 与 `tests/ui/message-copy.test.tsx`，预期全部通过；执行类型检查。

### 任务 3：真实浏览器验证

- [x] `tests/e2e/mermaid.spec.ts` / `tests/e2e/fixtures/mermaid.tsx` / `tests/e2e/mermaid.config.ts` 使用 Vite 和真实 Mermaid，验证中文流程图、时序图、多个图表、流式补全、非法语法恢复、手机布局和源码复制。
- [x] 运行 `npm exec -- playwright test --config tests/e2e/mermaid.config.ts`，预期全部通过。
- [x] 运行 `NODE_OPTIONS=--no-experimental-webstorage npm test` 和 `npm run build`。

### 任务 4：提交与固定渠道交付

- [ ] 按 `docs/commit-conventions.md` 精确暂存本次文件，执行 `git diff --check` 和 `git diff --cached --check`，提交并推送；保留其他未提交工作。
- [ ] 从本次提交导出独立构建快照，沿用已验证的 Android 包装与签名；读取固定清单，选择更高的版本并构建 APK。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <APK> --version <版本> --notes <说明>` 发布。
- [ ] 完整核验固定 JSON、HEAD 和 GET 的版本、大小与 SHA-256，清理临时文件，提供固定链接与校验信息。

## 验证记录

- 根因：共享 Markdown 渲染器仅提供普通代码块，仓库没有 Mermaid 依赖或图表渲染实现。

- TDD：5 个图表用例先因缺少渲染而失败；修复后 Mermaid 与消息复制聚焦测试通过。
- 真实浏览器：3 个用例通过，验证中文流程图、时序图、复制、源码切换、流式补全、错误清理和禁用脚本回调；已检查手机尺寸截图。
- 仓库：最新全量 680 条测试通过，类型检查与生产构建通过；全量测试显式排除其他任务创建的 `.mobile-build` 构建快照，避免扫描其依赖和重复测试。
- 发布资源扫描：新增 Android/iOS 回归先失败，精确允许 Mermaid 及解析器文档链接和 XML 命名空间后，16 条聚焦测试通过；实际 dist 扫描通过。
