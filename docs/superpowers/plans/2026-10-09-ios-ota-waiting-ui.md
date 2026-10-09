# iOS OTA 安装等待提示实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 点击安装后立即显示等待 UI，防止重复请求，等待过久可以重试。

**Architecture:** 从现有发布器抽出安装页渲染函数，按钮继续使用原生 `itms-services` 链接。页面显示等待图标和状态提示，15 秒后恢复重试入口；只表达安装请求状态，不推断系统安装完成。增加在发布锁内原子刷新现有安装页的命令，只更新 HTML，保持包、清单和版本不变。

**Tech Stack:** Python、原生 HTML/CSS/JavaScript、unittest、Node.js/jsdom。

## Task 1：等待页面与局域网刷新

Files: `scripts/ios_ota.py`、`tests/ci/test_ios_ota.py`、`tests/ci/ios_ota_waiting_ui.mjs`、`docs/ios-ota-release.md`。

- [x] 先写行为测试：生成真实安装 HTML，使用 jsdom 执行点击，断言首击保留链接默认行为并显示等待，二次点击被拦截，15 秒超时恢复重试，前后台切换不留下永久禁用；新标签点击不误触发等待。
- [x] 写刷新测试：已发布目录刷新后 HTML 更新，IPA、manifest、JSON 和 current symlink 字节/目标不变，损坏 IPA 拒绝刷新。
- [x] 运行 `python3 -m unittest discover -s tests/ci -p 'test_ios_ota.py'`，确认新增测试因功能缺失失败。
- [x] 实现 `render_install_page(release)`；`create_release` 调用渲染函数；实现 `refresh_install_page(root)` 与 `refresh-page --root` 命令。共享 `.publish.lock`，调用 `check_package`，同目录临时 HTML 使用 644 权限、原子替换及失败清理。
- [x] 运行上述测试并完成实现者自查：21 项通过（原有 10 项、UI 7 项、刷新 4 项）；独立需求审查和代码质量审查由主任务继续完成。
- [x] 文档说明等待是请求状态、页面无法获取系统安装结果，记录刷新命令。
- [x] 提交实现、测试和文档，使用中文 Conventional Commit。
- [x] 独立需求与代码质量审查均 Approved；WebKit 验证通过，已推送并合入 main。
- [x] 从长期主工作区执行 `python3 scripts/ios_ota.py refresh-page --root "$HOME/Library/Application Support/CodexMobile/ota-server/channels/codex-mobile"`，HTTPS GET 验证页面包含状态区域和脚本，再核对现有包和清单没有改变。
- [x] 保存验证记录并交付固定安装页；测试工作区使用宿主原生归档流程收尾。

## 验收

只改安装页和发布工具，不改客户端代码，不重新构建双端安装包。既有版本 0.2.128 的签名包及身份保持原样。真机系统弹窗延时不可由网页消除，UI 应明确提示等待用户确认系统弹窗。

工作区复用主目录依赖时，测试命令前设置 `NODE_PATH=<主工作区>/node_modules`；已有本地依赖或 CI 完成 `npm ci` 时无需额外设置。

## 执行证据

- 2026-10-09：OTA 和服务端回归共 36 项通过；合入 main 后 OTA 21 项再次通过。
- 对真实部署 HTML 使用 WebKit 390×844 验证等待、15 秒重试、无横向溢出和减少动态效果（实际 `animationName=none`）。
- 固定 HTTPS 安装页 GET 与本地 HTML 字节一致，缓存策略为 `no-cache`。
- 当前版本仍为 0.2.128；IPA、manifest、JSON 散列及 current 目标未改变。HTTPS 完整 IPA 下载核对 3,763,499 字节，SHA-256 为 `03744bce87e5d554cee4c43fc6f2f96236d02a84c24c7db6852139a7e39404a2`。
- 验证记录保存于长期主工作区 `.mobile-build/ota-waiting-ui/verification.json`，截图为同目录 `waiting.png`。
- 本次验证网页状态与部署，不把浏览器模拟点击当作 iPhone 系统安装结果。
