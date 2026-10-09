# iOS 版本号显示实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话逐步执行，并遵循 superpowers:test-driven-development。用户已要求提交、推送和双平台固定渠道发布。

**Goal:** iOS 在管理设备底部显示与安装包一致的当前版本。

**Architecture:** 复用现有版本信息区域，将版本显示与 Android 更新能力分开。Android 优先读取原生版本；其他平台读取流水线已有的 VITE_APP_VERSION，开发环境回退 0.2.0。

**Tech Stack:** React、TypeScript、Vitest、PakePlus、Xcode、Gradle。

- [x] 在 `tests/ui/backend-components.test.tsx` 添加不支持 APK 更新时仍显示版本且没有更新按钮的用例；在 `tests/ui/app-update-hook.test.tsx` 使用 `vi.stubEnv("VITE_APP_VERSION", "0.2.100")` 验证无 Android 桥时使用发布版本，保留原生版本优先级。
- [x] 执行 `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/ui/backend-components.test.tsx tests/ui/app-update-hook.test.tsx`，确认新用例因版本隐藏及 0.2.0 回退而失败。
- [x] 修改 `src/features/update/useAppUpdate.ts` 回退为 `import.meta.env.VITE_APP_VERSION?.trim().replace(/^v/, "") || "0.2.0"`；修改 `src/features/backends/BackendManagerSheet.tsx` 为存在 appUpdate 即显示区域，仅 supported 时显示更新按钮和状态，iOS 使用“应用信息”标签；在 `src/i18n.tsx` 添加 `"应用信息": "App info"`。
- [x] 运行上述测试及现有 `tests/ui/app-update-*.test.*`、`tests/ui/i18n.test.tsx`、`tests/ci`，执行 `npm run typecheck` 和 `git diff --check`。
- [ ] 在 README 记录 iOS 版本号查看位置，按提交规范提交并推送。
- [ ] 从已推送源码构建 APK、未签名 IPA 0.2.100，核验原生版本与内置前端发布版本一致。
- [ ] 分别执行 `python3 /Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py publish-channel codex-mobile <安装包> --version 0.2.100 --notes 'iOS 管理设备底部新增当前版本号显示；Android 同步发布。'`。
- [ ] 对两个固定渠道执行 JSON、HEAD、完整 GET 检查，对比版本、大小、SHA-256；保存交付证据并清理临时构建文件，回复固定下载链接和校验信息。
