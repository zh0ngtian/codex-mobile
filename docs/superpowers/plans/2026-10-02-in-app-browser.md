# 内置浏览器界面实施计划

> **执行要求：** 按 superpowers 的 planning、TDD、verification-before-completion 流程逐项执行。

**目标：** 点击 Codex Mobile 内的普通 HTTP/HTTPS 链接时，不再替换主应用页面，而是打开与参考图一致的独立内置浏览器；提供关闭、动态标题、外部浏览器、重新加载、桌面版网页和全屏打开能力。

**交互边界：**

- 主 App 继续由 `file:///android_asset/index.html` 承载，内置页面和前端路由不受影响。
- 常见文件下载仍走既有 DownloadManager，不进入内置浏览器。
- 普通 HTTP/HTTPS 链接进入独立 `InAppBrowserActivity`，浏览器内继续导航不重复创建 Activity。
- 内置浏览器不注册 Codex Mobile 的 `JsBridge`，避免外部网页获得应用专用能力。
- 页面标题优先使用 HTML title，空标题回退到站点域名。
- 返回键依次退出全屏、回退网页历史、关闭浏览器。

## 任务 1：先写失败的原生浏览器契约测试

**文件：**

- 修改 `tests/ci/mobile-packaging-workflows.test.ts`
- 新增 `mobile/android/InAppBrowserActivity.kt`

1. 断言 Android 主 WebView 会把普通 HTTP/HTTPS 链接交给 `InAppBrowserActivity`。
2. 断言清单注册不可导出的内置浏览器 Activity。
3. 断言独立浏览器具备关闭、动态标题和四项菜单功能。
4. 断言内置浏览器没有注册 `JsBridge`。
5. 先运行聚焦测试，确认当前工作流因尚未实现这些契约而失败。

## 任务 2：最小实现原生浏览器

**文件：**

- 新增 `mobile/android/InAppBrowserActivity.kt`
- 修改 `.github/workflows/build-android.yml`

1. 在 PakePlus 项目生成后复制独立浏览器 Activity。
2. 在主 WebView 的 URL 拦截中保留下载分支，并将其余 HTTP/HTTPS 链接交给内置浏览器。
3. 在 AndroidManifest 中注册 `exported=false` 的 Activity。
4. 使用 Material/AppCompat 自带图标和原生控件还原浅色顶栏、关闭按钮、动态标题和右上菜单。
5. 实现外部浏览器、刷新、桌面 UA 切换与全屏模式；补齐网页历史、生命周期和错误回退。
6. 运行聚焦测试并确认通过。

## 任务 3：构建级与真机视觉验证

1. 运行完整单元测试、类型检查、生产构建和差异检查。
2. 使用固定 PakePlus 提交生成 Android 项目并编译 APK。
3. 在已连接 Android 设备安装 APK，从 App 内打开测试链接，验证关闭、标题、菜单、刷新、桌面版、全屏和返回历史。
4. 捕获相同打开态截图，与用户参考图比较；修复 P0/P1/P2 差异并在 `design-qa.md` 记录最终结果。

## 任务 4：提交、推送与固定渠道发布

1. 按仓库提交规范检查并提交本次计划、测试、原生界面和工作流修改。
2. 推送 `main`。
3. 以高于固定渠道 v0.2.48 的版本构建 APK。
4. 使用 `apk-server.py publish-channel` 发布到 `codex-mobile` 固定渠道。
5. 通过固定 JSON、HEAD、GET 核对版本、Content-Type、文件大小和 SHA-256。
6. 删除本次无后续用途的临时构建目录和截图中间件。
