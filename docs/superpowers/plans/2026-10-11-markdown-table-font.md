# Markdown 表格字号修复计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话执行；按 TDD 验证、提交推送及双端固定渠道发布。

**目标：** 长 commit ID 和 SHA-256 表格保持正文的行内代码字号，避免移动浏览器自动放大，继续支持横向滚动及应用字号设置。

**架构：** ReactMarkdown / remark-gfm 已正确生成表格和 code 元素。只为 Markdown 表格固定 100% text-size-adjust，保留现有 .88em 行内代码与滚动样式。桌面移动仿真验证字号、文本高度、滚动和实际计算的自动调整策略；不把它当作真机问题复现。

**技术栈：** React、CSS、Playwright WebKit/Chromium、Vitest、iOS Ad Hoc OTA、GitHub Actions。

### 1. 验证与修复

涉及文件：`src/styles.css`、`tests/e2e/markdown-table.spec.ts`、`tests/e2e/markdown-table.config.ts`。

- [x] 在两个移动浏览器上测试原会话中的 40 位 commit 与 64 位 SHA-256，375px、标准与 1.3 倍字号；比较表格代码与正文代码的实际文本高度，断言 .88em 字号、页面宽度和表格滚动。
- [x] 运行 `npm exec -- playwright test --config tests/e2e/markdown-table.config.ts`，确认自动字号策略当前为 auto，未满足 100% 的约束。
- [x] 为现有 `.markdown-body table` 增加 `-webkit-text-size-adjust: 100%; text-size-adjust: 100%;`。
- [x] 重跑浏览器测试；运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/layout-css.test.ts tests/ui/conversation.test.tsx` 与 `npm run build`。

### 2. 提交与交付

- [ ] 遵循 `docs/commit-conventions.md`，执行 diff 检查、提交修复、合入并推送 main。
- [ ] 取得主工作区 `.mobile-build/.fixed-channel-publish.lock`，结合 GitHub 新流水线版本及两端固定渠道分配统一更高版本。
- [ ] 等待 main 双端流水线成功，下载同一源码 APK。运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '修复 Markdown 表格长 commit ID 和 SHA-256 字号异常放大'`。
- [ ] 使用 `apk-server.py publish-channel codex-mobile <APK> --version <统一版本> --notes '修复 Markdown 表格长标识符字号异常放大'` 发布 APK；回验两端清单、HEAD、完整 GET 的版本、大小、SHA-256。
- [ ] 读取 SignOs 最新软件源发布指令，使用同一已签名 IPA，按当前 GitHub 登录账号追加或保留开发者署名，发布并核验软件源。
- [ ] 保存发布凭证与测试结论，清理临时构建目录并归档 worktree。测试使用静态协议与排版样本，不创建真实测试会话。

## 修复验证

- Chromium 首次回归因自动字号策略为 auto 失败，修复后为 100%。macOS WebKit 不支持该 iOS CSS 属性，按能力检测验证字号与布局，不宣称真机复现。
- 两浏览器标准/1.3 倍字号共 4 项通过；40 位提交与 64 位 SHA-256 保持 .88em，文本高度不超过正文代码，横向滚动可到末端且页面不超宽。
- 相关 UI 回归 2 文件 100 项通过，`npm run build` 通过。首次试验的字号变量误放 body 已改为 html；该试验失败不是产品缺陷。
- 上游原 `cloudflare/app-source/PUBLISH_PROMPT.md` 已迁移，通过 GitHub API 读取最新 `distribution/app-source/PUBLISH_PROMPT.md`，按其中要求使用现役家中 HTTPS 软件源，不恢复旧 Cloudflare 发布。
