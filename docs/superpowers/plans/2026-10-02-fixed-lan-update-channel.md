# 固定局域网更新渠道实施计划

> **执行要求：** 按 superpowers 的 planning、TDD、verification-before-completion 流程逐项执行。

**目标：** 将 Codex Mobile 的“检查更新”和 APK 下载切换到固定局域网渠道，并把后续每次仓库修改后的 APK 固定发布到该渠道。

**固定协议：**

- 更新清单：`http://192.168.123.79:8765/channels/codex-mobile/latest.json`
- APK：`http://192.168.123.79:8765/channels/codex-mobile/latest.apk`
- 清单包含语义版本、更新说明、固定下载地址、APK 字节数和 SHA-256。
- 固定渠道不使用临时文件的 48 小时过期策略；新版本以原子文件替换方式覆盖旧版本。
- 发布只允许通过服务器本机 CLI 写入，HTTP 渠道只读，避免局域网匿名上传直接覆盖更新渠道。

## 任务 1：先写失败的固定渠道服务测试

**仓库：** `/Users/zhongtian/WorkSpace/GlobalTranslation`

**文件：**

- 新增 `tests/test_apk_server.py`
- 修改 `scripts/apk-server.py`

1. 测试发布 APK 后固定 JSON 与 APK 路径均可读取。
2. 测试清单中的版本、固定 URL、字节数与 SHA-256 正确。
3. 测试再次发布后两个固定路径返回新版本，且固定渠道不进入 48 小时临时文件清理。
4. 先运行测试并确认因固定渠道尚未实现而失败。
5. 最小实现 `publish-channel` 本机命令和只读 HTTP 路由，再运行测试通过。

## 任务 2：先写失败的 App 更新协议测试

**仓库：** `/Users/zhongtian/WorkSpace/codex-mobile`

**文件：**

- 修改 `tests/ui/app-update-release.test.ts`
- 修改 `tests/ui/app-update-hook.test.tsx`
- 修改 `tests/ui/app-update-sheet.test.tsx`

1. 将夹具改为固定局域网清单格式。
2. 断言只接受精确固定的清单与 APK 地址、有效语义版本、正 SHA-256 和正文件大小。
3. 断言安装桥接收到固定 APK 地址和清单摘要。
4. 先运行聚焦测试并确认旧 GitHub Release 实现不满足新契约。

## 任务 3：最小实现 App 与原生下载限制

**文件：**

- 修改 `src/app-update/release.ts`
- 修改 `src/features/update/useAppUpdate.ts`
- 修改 `src/i18n.tsx`
- 修改 `.github/workflows/build-android.yml`
- 修改 `tests/ci/mobile-packaging-workflows.test.ts`

1. 检查更新只请求固定局域网清单。
2. 清单解析只接受固定 APK URL，并继续校验 SHA-256、版本和大小。
3. 更换缓存键，避免旧 GitHub Release 缓存被继续使用。
4. Android 原生下载器只接受固定 HTTP URL、拒绝重定向，并在下载后继续校验 SHA-256。
5. 更新工作流结构测试，聚焦测试通过后再运行完整前端测试、类型检查和构建。

## 任务 4：固化后续交付规则

**文件：**

- 修改 `AGENTS.md`
- 修改 `README.md`
- 修改 `/Users/zhongtian/WorkSpace/GlobalTranslation/AGENTS.md`
- 修改 `/Users/zhongtian/WorkSpace/GlobalTranslation/docs/testing/ACCEPTANCE.md`

1. 记录固定渠道地址、发布命令、校验要求和不再过期的行为。
2. 明确 Codex Mobile 每次仓库修改完成、提交并推送后，都要构建更高版本 APK 并覆盖固定渠道。
3. 临时上传仍保留原有随机链接与 48 小时有效期，避免影响其他 App 的交付。

## 任务 5：提交、推送、构建与发布

1. 分别按两个仓库的提交规则检查差异、提交并推送 `main`。
2. 以高于现有 `v0.2.30` 的版本构建 Android APK，并验证包名、版本、签名、权限和内置资源。
3. 使用本机 CLI 发布到 `codex-mobile` 固定渠道。
4. 通过固定 JSON、HEAD、GET 回验版本、Content-Type、字节数和 SHA-256。
5. 若连接测试真机可用，覆盖安装并验证 App 内检查更新；否则明确记录未完成的真机验证。
6. 清理本次临时构建和下载校验文件。
