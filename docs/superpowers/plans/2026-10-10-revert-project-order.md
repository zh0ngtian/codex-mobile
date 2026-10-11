# 回退项目拖动排序实施计划

> **执行要求：** 使用 superpowers:executing-plans 在当前会话执行，遵循 TDD；按仓库约定提交、推送及双端固定渠道发布。

**目标：** 撤销本次项目拖动与新聊天同步排序，恢复项目原有顺序，保留后续通知修复和文档整理。

**架构：** 仅反向应用 `e783a88` 的 `src/` 与 `tests/` 变更，删除专属排序模块、手柄、状态及缓存读写。现有本机排序键不再读取，无需清除用户其他存储。保留历史发布记录，更新现役 README 与文档索引。

**技术栈：** React、TypeScript、Vitest、Playwright、GitHub Actions、iOS Ad Hoc OTA。

- [x] 在 `tests/ui/thread-list-page.test.tsx` 增加“项目标题保留折叠操作并移除排序手柄”；运行 `NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/thread-list-page.test.tsx -t '项目标题保留'`，确认因仍有手柄失败。
- [x] 在 `tests/e2e/project-order-rollback.spec.ts` 模拟目录 `alpha/beta/gamma` 与旧本机排序 `gamma/alpha/beta`；确认边栏和新聊天选择都使用原目录顺序且无手柄。
- [x] 对 `git diff e783a88^ e783a88 -- src tests` 反向应用，保留上述回退回归；移除 README 的现役拖动排序说明，索引注明已回退。
- [x] 执行列表、边栏滑动、刷新、项目分组测试与 `npm run build`；运行上述 Playwright 回归，预期全部通过。
- [x] 按中文 Conventional Commits 提交并推送 main；固定发布期间持有 `.mobile-build/.fixed-channel-publish.lock`，读取两端与 OTA 版本并分配统一更高版本。
- [x] 从已推送源码运行 Android 流水线；使用本机 `npm run ios:release -- --config "$HOME/Library/Application Support/CodexMobile/ios-release.local.json" --version <版本> --notes '回退项目拖动排序，恢复原项目列表顺序'` 构建、签名、发布 iOS。
- [x] 发布相同版本 APK，通过两端固定 JSON、HEAD、完整 GET 核对版本、大小、SHA-256；核对双端内嵌前端一致且排序缓存代码已删除。
- [x] 保存交付证据到主工作区，清理临时构建目录并归档 worktree；本次协议模拟不创建真实测试会话。


## 验证记录

- 新回归先因仍存在 2 个排序手柄失败；反向应用后通过，项目标题折叠仍可用。
- 相关 4 文件、56 项测试通过；类型检查发现新增测试误用 Testing Library 的 `exact` 参数，移除后 `npm run build` 通过。
- Playwright 1 项通过，确认旧缓存不会改变边栏或新聊天选项顺序，reload 后仍使用原目录顺序。首次浏览器执行发生在失败构建之后，未生成前端；完成构建后场景通过。
- `git diff e783a88^ -- src` 无差异，客户端运行代码精确恢复到新增该功能之前；后续服务端通知修复保留。
- 已取得固定渠道发布锁，Android 和 iOS 当前均为 `0.2.138`，本次选择统一 `0.2.139`；iOS 配置与身份连续性预检通过。


## 发布结果

- 回退提交 `6a430883b29cae6585b38440fc85009c232291ab` 已推送 `origin/main`，保留后续文档整理和子会话静默通知修复。
- [双端构建流水线](https://github.com/zh0ngtian/codex-mobile/actions/runs/38029219302)成功，统一版本 `0.2.139` / build `2139`；固定 IPA 使用本机 Ad Hoc 签名产物。
- [固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)：受信任 CA、页面版本及 HTTPS 清单、HEAD、完整 GET 回验通过。
- [APK 固定下载](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)：`0.2.139`，`4,708,035` 字节，SHA-256 `06766facd8c707c80b544ebd93443d362e61e2fe8f01fba30cd6eaaaf378bc49`。
- [IPA 固定下载](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa)：`0.2.139`，`3,772,844` 字节，SHA-256 `f438283068cde1b1667be69f89ad846e90d60c8f145f0f7ac0dec4a81da06abc`，Ad Hoc 已签名；独立验签及身份、钥匙串连续性通过。
- 两端固定 JSON、HEAD、完整 GET 与本机构建产物一致。双端内嵌前端字节一致，SHA-256 `0ba11c50e06568280434d9fa8a44c179ce37631cc27cc48458e6fcdda891f3fa`；排序存储键与手柄代码不存在。
- 交付证据保留于主工作区 `.mobile-build/revert-project-order-release/`，临时构建工程与开发 worktree 在交付前清理归档。
- 使用协议模拟，无真实测试会话；未执行真机覆盖安装与数据保留验证。
