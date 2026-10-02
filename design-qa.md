# 内置浏览器 Design QA

- source visual truth path: 当前用户消息中的第 1 张参考截图（会话内附件，无本地文件路径）
- source pixels: 918 × 2048
- implementation screenshot path: `test-results/in-app-browser/implementation.png`
- implementation pixels: 984 × 2136
- CSS size: 不适用；Android 真机原生 Activity，设备逻辑宽度 375 dp
- density normalization: 参考图与真机截图按屏幕宽高比例对齐；状态栏、系统图标和设备安全区视为系统基础设施，不作为 App 内容差异
- viewport: Android 12 真机，984 × 2136 px，420 dpi override
- state: HTTP 页面加载完成，右上角操作菜单展开

## Full-view comparison evidence

参考图和真机最终截图均包含浅色状态栏、关闭按钮、动态网页标题、右上三点菜单、深色网页内容与右上悬浮白色操作面板。面板右对齐、圆角、四行操作顺序和页面遮挡关系一致；最终面板宽度约为屏幕的 45%，与参考图约 43% 接近。

## Focused region comparison evidence

菜单区域需要单独检查，因为首轮全图中它是主要偏差来源。最终实现使用 Google Material Icons Round 的 `open_in_new`、`refresh`、`desktop_windows` 和 `fullscreen` 图标；四项文案、图标顺序、行对齐和单行显示均与参考图一致。标题栏使用 Material Toolbar 的关闭和纵向三点图标，标题来自页面 HTML title。

## Required fidelity surfaces

- Fonts and typography: 标题采用 Material Subtitle2，菜单为 12sp 粗体；真机中最长文案保持单行，没有截断或溢出。系统字体与参考设备字体存在设备级差异，属可接受差异。
- Spacing and layout rhythm: 48dp 顶栏、48dp 菜单触控行、右对齐 160dp 面板、16dp 圆角；关闭、标题、三点与菜单内容保持稳定对齐。
- Colors and visual tokens: 顶栏为接近参考图的浅灰白，文字为近黑色，菜单图标使用深灰绿色；网页内容颜色由目标网页自身决定。
- Image quality and asset fidelity: 所有非系统菜单图标均来自 Google Material Icons Round 矢量资源，没有使用文字字符、CSS 图形或占位图。
- Copy and content: “在外部浏览器中打开”“重新加载”“桌面版网页”“全屏打开”与参考图一致；桌面版启用后明确切换为“手机版网页”。

## Comparison history

1. 首轮：菜单为 336dp、18sp，覆盖约 90% 屏宽；图标使用 Android 旧式内建资源。判定为 P1。
   - 修复：改用 Material Icons Round，重新按参考图测量面板与文字比例。
   - 后证据：`/tmp/codex-mobile-browser-menu-v2.png`，图标正确但面板仍偏宽。
2. 第二轮：菜单收窄到 272dp、16sp，层级正确，但仍明显宽于参考图。判定为 P2。
   - 修复：最终收窄为 160dp、12sp，压缩内边距并保留 48dp 触控行。
   - 后证据：`test-results/in-app-browser/implementation.png`，最长文案单行显示，面板比例与参考图接近。
3. 交互检查：验证主 WebView 点击 HTTP 链接进入独立 Activity；刷新、桌面版切换、全屏工具栏隐藏与返回恢复、外部浏览器、关闭均通过真机操作。

## Findings

没有仍需处理的 P0、P1 或 P2 差异。

## Follow-up Polish

- P3：不同 Android 厂商的系统状态栏高度与图标排列会和参考设备不同，这是系统基础设施差异，不在 App 内仿制。

final result: passed
