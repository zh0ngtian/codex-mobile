# Android WebView 开发验收

## 2026-11-11：删除原生呈现并恢复直接显示共享页面

用户在实机查看后明确要求删除 Android 原生代码，保留现有 Web 页面。main 基线为 `69ac70a9468a7eee3632c105a82dfa2668225752`，本轮仅源码和独立 QA 验证，尚未发布正式 APK 或部署网关。

已移除 Compose 页面、AndroidNativeHost、原生启动桥、专用仪器测试和对应依赖。Android 直接显示内置共享页面，旧原生模式偏好不再参与启动，原生切换开关仅在 iOS 显示。Android 容器及现有系统桥保留，共享原生业务代码继续服务 iOS。

| 验证 | 结果与边界 |
| --- | --- |
| 工程准备 | `npm run android:prepare` 完整通过，包含 TypeScript 检查、Web 构建、嵌入资源扫描、固定容器生成和系统桥硬化。GitHub HTTPS 在本机不可用，固定容器从本机已有同一 SHA 对象取得，没有更换来源提交。 |
| Android 容器编译 | `:app:compileDebugKotlin` 通过；运行依赖树中没有 Compose、Markwon、Coil 或 ZXing。直接依赖 Activity KTX 保留 edge-to-edge API。 |
| 关键回归 | 7个文件67项通过，覆盖 Android 直接挂载网页、不再提供原生偏好、容器配置重复执行、构建 recipe，以及 iOS 设置、字号、检查点与恢复。 |
| 扩展回归 | 23个文件329项中327项通过。`native-ui-app.test.tsx` 的两项“目录和会话同时读取失败”夹具期望会话错误，但收到目录错误；恢复修改前的完整偏好代码后同样失败。本轮未改对应业务或错误优先级，不将其报告为全部通过。另修正设备地址测试沿用旧 `secureField` 的断言，与既有明文 `textField` 要求一致。 |
| 独立 QA 构建与安装 | `:app:assembleDebug` 通过，覆盖更新实机已有 `vip.loock.codexmobile.material3qa`，桌面名称改为 `Codex Mobile Web QA`。沿用0.3.0/3000调试元数据，原正式包保留；不代表正式应用覆盖升级或数据保留已验证。 |
| 实机页面 | OnePlus PME110／Android17，沿用当前字号、密度和竖屏。冷启动直接进入 Web 侧栏，原 QA 设备配置仍可连接指定网关；设备管理中的传输、推送、字体、设备及添加入口完整显示，没有原生界面开关。新对话页面、项目/机器选择、输入区与发送按钮可见，未发现本轮移除造成的裁切或系统栏遮挡。 |

本机日志和三张截图保存在当前 worktree `.mobile-build/android-web-20261111/`，分别为 `01-web-start.png`、`02-web-menu.png`、`03-web-new-chat.png`。截图包含真实设备和会话信息，仅保存在忽略目录，不提交仓库。实机保留用户已授权的 QA 应用，最终停在空的新对话页面。

本轮没有发送消息、创建后端测试会话、归档或改变真实会话；没有更改系统字号、显示密度、输入法或推送设置。发送、审批、队列、附件、软键盘完整流程、正式升级及长期运行未重新做真机端到端验收。此前 Android 原生版的证据保留在[历史验收](android-native-verification.md)，现行要求见[交互约定](interaction-alignment.md)。
