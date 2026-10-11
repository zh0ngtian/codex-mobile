# 边栏草稿图标实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 在隔离 worktree 连续实施。

**Goal:** 边栏刷新按钮左侧的草稿文字改为图标，点击继续打开全部本地草稿。

**Architecture:** 复用 AppIcon 的 SVG 规范与 round-button 样式，新增带文本线条的纸张图标；保留本地化 aria-label 和 title。清除原文字按钮专用 CSS。

**Tech Stack:** React、TypeScript、Vitest、Playwright、既有双端发布脚本。

## Task 1：图标替换与验证

**Files:** `src/features/threads/ThreadListPage.tsx`、`src/ui/app-display.tsx`、`src/styles.css`。

- [x] 运行现有列表与草稿单元测试，确认基线；浏览器观察修改前草稿按钮没有 SVG（RED）。本次为可逆视觉小改，依仓库规则不新增复述实现的测试。
- [x] 新增 `draft` AppIcon：`<path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4M9 12h6M9 16h6" />`。
- [x] 使用 `<button type="button" className="round-button" aria-label={t("草稿")} title={t("草稿")} onClick={onOpenDrafts}><AppIcon name="draft" /></button>`，移除 sidebar-drafts-button 相关 CSS。
- [x] 运行现有单元测试、双浏览器草稿端到端回归及 `npm run build`；检查 320/393px 截图、44px 点击区域、无障碍名称与入口点击。

## Task 2：提交与发布

- [ ] 按中文 Conventional Commit 提交，快进合入 main 并推送。
- [ ] 获得固定渠道锁，读取 Android/iOS/GitHub 版本；GitHub Actions 构建 APK 与 unsigned IPA，本机 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一更高版本> --notes '边栏草稿文字改为图标'` 签名及发布。
- [ ] 使用既有 `apk-server.py publish-channel` 发布相同版本 APK；核对 JSON/HEAD/完整 GET 版本、大小、SHA-256、签名身份及 OTA 页面；核对软件源对应 unsigned IPA。
- [ ] 保留发布回执与必要截图，清理临时文件，归档 worktree，释放锁；交付固定 OTA、APK、IPA 链接及版本、大小、SHA-256。

## 开发验证

- 基线与修改后的现有单元测试均 39 项通过；生产类型检查及构建成功。
- 浏览器修改前观察到按钮为“草稿”文本且无 SVG，修改后 Chromium/WebKit 均为仅图标、aria-label/title 为草稿、44×44 点击区域，320/393px 保持刷新左侧；点击进入草稿列表。
- 现有双浏览器草稿端到端回归 10 项全部通过，覆盖附件保存恢复、发送失败保留与成功移除、完整配置、删除及错误路径。
- 未创建真实 Codex 测试会话；浏览器验证不代表真机覆盖安装验收。
