# 回退逐文件统计展示

> 执行：superpowers:executing-plans 在独立 worktree 逐项完成，遵循 TDD；固定渠道发布持锁串行。

**目标：** 对话恢复原来的工具活动显示方式，只展示总改动；用户主动进入 Diff 详情时保留原有文件查看能力。

**架构：** 定向删除 FileChangeActivity 与其样式；ToolActivity 恢复统一活动列表。移除本次逐文件卡片引入的 initialFileIndex 参数。保留后续阶段展示、过程折叠和会话回填改动。

- [x] 基线：`NODE_OPTIONS=--no-experimental-webstorage npm test -- tests/ui/conversation.test.tsx tests/ui/tool-sheets.test.tsx`。
- [x] 修改现有逐文件回归，断言展开过程后仍无逐文件卡片、总数正确；先确认旧实现失败。
- [x] 回退 Timeline、ToolSheets 与相关 CSS；浏览器验收改为只显示总数，主动点击原活动仍可进入 Diff。
- [x] 运行相关 Vitest、`npm run build` 和专项 Playwright；`git diff --check`。
- [x] 持有主工作区固定渠道锁，读取在线版本并分配更高版本；提交推送 main，使用自动双端构建及本机 `ios:release`。
- [x] 固定 APK、IPA、HTTPS OTA 清单/HEAD/完整 GET 验证；软件源只核对 unsigned IPA 订阅版本，不上传签名包。
- [x] 保留正式签名包与 ota-release.json，记录交付，清理临时资源；完成记录推送后由平台归档 worktree。

## 本地验证

- 现有用例先红后绿，84 个相关 Vitest 用例通过。
- `npm run build` 与专项 Playwright（1 个）通过，375×812 截图确认只显示总改动且无横向溢出。
- 持锁核对双端渠道均为 0.2.162，下一版分配 0.2.163；iOS 发布预检通过，升级身份保持连续。

## 构建阻塞修复

- 首次双端 CI 与本机准备均失败：`pnpm@10` 解析到 10.34.7，其 npm tarball 返回 404；10.34.6 的 tarball 返回 200。
- 先增加双端/本机精确版本一致性回归并确认失败，再将 workflow、双端 recipe 和本机准备入口统一固定 10.34.6，避免自动解析到不可下载版本。

## 完成交付

- 回退实现 `e25a8d5` 与构建修复 `6ec89b6` 均已推送 `main`；[双端 CI](https://github.com/zh0ngtian/codex-mobile/actions/runs/38211073586) 成功，发布 [v0.2.163](https://github.com/zh0ngtian/codex-mobile/releases/tag/v0.2.163)。构建回执与该提交一致。
- 对话恢复原工具活动入口，只显示总改动；主动进入 Diff 仍能查看文件详情。保留后续阶段展示与过程折叠行为。
- 84 项相关 UI 单元测试、1 项专项浏览器测试及生产 Web 构建通过；构建阻塞修复先红后绿，49 项 CI 契约测试通过，真实安装 pnpm 10.34.6 成功。375×812 截图确认仅显示总数且无横向溢出。
- APK：0.2.163，4,721,043 字节，SHA-256 `3e7e3a699f7aca4691f4a87c84323dce9e50704d3989e5dac623ace1a1e1aaf8`。
- Ad Hoc 已签名 IPA：0.2.163，3,790,164 字节，SHA-256 `de80f5592eeb3c4b0fb0a4087177e2e65bb69b44935797d9212c77f4e29540cd`。
- 固定双端清单、HEAD、完整 GET 及 HTTPS OTA 全部回验通过。两个安装包的前端脚本 SHA-256 一致（`a4f89d92a6ebac593b8865a3af51014a6d4e10e021f4a2610ffc8ac4701111a0`），均保留 `turn-change-summary` 且没有 `file-change-activity`。
- 独立验签确认 `vip.loock.codexmobile`、`SC456JW7RP.app.jade6694.grapefruit3766` 与原钥匙串组保持连续；未执行真机覆盖安装验证。
- [固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)、[固定 APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk)、[固定 IPA](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) 均已更新。
- 软件源现有订阅同步 unsigned IPA 0.2.163（2163），3,766,714 字节，SHA-256 `3a533ab8cc3220b598b4739fa6bb93c230687004690160ef9eaf4a1a392a87b2`；URL、版本、构建号、大小与 GitHub Release 一致，完整下载核验并提交散列证明。开发者署名保持 `zh0ngtian`，没有上传签名包或创建新订阅。
- 正式签名包、签名报告、OTA 回执、双端构建回执、截图与渠道/软件源验收 JSON 保存于长期主工作区 `.mobile-build/revert-file-change-release/`。临时构建目录已清理；浏览器验证使用 mock，没有创建需要归档的远程测试会话。完成记录推送后释放锁并由平台归档独立 worktree。
