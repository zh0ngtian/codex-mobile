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

- [x] 遵循 `docs/commit-conventions.md`，执行 diff 检查、提交修复、合入并推送 main。
- [x] 取得主工作区 `.mobile-build/.fixed-channel-publish.lock`，结合 GitHub 新流水线版本及两端固定渠道分配统一更高版本。
- [x] 等待 main 双端流水线成功，下载同一源码 APK。运行 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <统一版本> --notes '修复 Markdown 表格长 commit ID 和 SHA-256 字号异常放大'`。
- [x] 使用 `apk-server.py publish-channel codex-mobile <APK> --version <统一版本> --notes '修复 Markdown 表格长标识符字号异常放大'` 发布 APK；回验两端清单、HEAD、完整 GET 的版本、大小、SHA-256。
- [x] 读取 SignOs 最新软件源发布指令，使用同一已签名 IPA，按当前 GitHub 登录账号追加或保留开发者署名，发布并核验软件源。
- [x] 保存发布凭证与测试结论，清理临时构建目录并归档 worktree。测试使用静态协议与排版样本，不创建真实测试会话。

## 修复验证

- Chromium 首次回归因自动字号策略为 auto 失败，修复后为 100%。macOS WebKit 不支持该 iOS CSS 属性，按能力检测验证字号与布局，不宣称真机复现。
- 两浏览器标准/1.3 倍字号共 4 项通过；40 位提交与 64 位 SHA-256 保持 .88em，文本高度不超过正文代码，横向滚动可到末端且页面不超宽。
- 相关 UI 回归 2 文件 100 项通过，`npm run build` 通过。首次试验的字号变量误放 body 已改为 html；该试验失败不是产品缺陷。
- 上游原 `cloudflare/app-source/PUBLISH_PROMPT.md` 已迁移，通过 GitHub API 读取最新 `distribution/app-source/PUBLISH_PROMPT.md`，按其中要求使用现役家中 HTTPS 软件源，不恢复旧 Cloudflare 发布。

- 补充横屏 812×375、应用最大字号 1.25 与减少动态效果检查通过；字号为 17.6px，表格独立滚动，页面宽度保持 812px。375px 大字号截图已检查，表格与正文代码字号一致。

## 发布结果

- 修复提交 `77e56eef2ef1eb55ff7f76402bd8334efadc0260` 已合入并推送 main。
- [双端流水线 38116508584](https://github.com/zh0ngtian/codex-mobile/actions/runs/38116508584)全部成功；[GitHub Release v0.2.149](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.2.149)包含 APK 和云端未签名 IPA，固定渠道使用本机 Ad Hoc 已签名 IPA。
- [固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)及 HTTPS IPA，固定 LAN 两端清单、HEAD、完整 GET 均回验通过。
- [APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)：0.2.149，4,714,299 字节，SHA-256 `9fbf34655c3f147e83e6b1182a322359e7b01cd68ec3a781f294ff54a286a4c6`。
- [IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)：0.2.149，3,781,956 字节，SHA-256 `7c8ca4a3effca9f72924c38d44700e0fe63291d683d35ee2c1db81814deefcfb`，Ad Hoc 已签名；应用身份、权限与钥匙串组连续性通过。
- 两端内嵌修复 CSS 字节一致；软件源使用同一签名 IPA，版本/build 2149、大小、散列、HEAD、完整 GET 一致，保留 `loock-ai / zh0ngtian / Roxbili` 署名。软件源地址来自私有配置，未写入仓库。
- 发布包和凭证保留在主工作区 `.mobile-build/markdown-table-font-release/0.2.149/`。本次未创建真实测试会话；未执行真机覆盖安装、数据保留或原会话 UI 验证。
