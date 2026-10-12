# Windows 项目名称兼容实施计划

> 执行方式：使用 superpowers:executing-plans 在当前会话逐项实现，遵循 superpowers:test-driven-development。

**目标：** 项目分组、新建聊天选项与对话顶部显示 Windows 路径的末级目录名称。

**架构：** 用一个浏览器可用的路径名称函数同时识别 `/` 和 `\`，各调用位置保留原有空值提示。只派生显示名称，不改写 `cwd`、分组键和请求参数。

**技术栈：** TypeScript、React、Vitest、Playwright。

**设计依据：** 已复现 Windows 完整路径被当成项目名；用户确认“修改一下，兼容 windows 路径”。

## 全局约束

- 在独立 worktree 开发和构建；文档与提交描述使用中文。
- 不引入 Node.js 路径模块或新依赖；保持现有 macOS/Linux 项目名与无项目提示。
- 修改完成后提交推送；客户端修改须按 AGENTS.md 完成同版本 APK 与已签名 IPA 发布。
- 测试使用离线数据，不创建真实 Codex 会话。

## 审查重点

- Windows 盘符、UNC 与混合分隔符均显示末级目录。
- 尾部重复分隔符、首尾空白不进入显示名称。
- 缺失路径与无项目会话保留原提示。
- 同名但不同目录的项目继续使用原始完整路径区分。
- 新建聊天仍以完整路径作为选项值和请求工作目录。

## 任务 1：修复三个显示入口并验证

**文件：** 新增 `src/lib/path-basename.ts`；修改 `src/features/threads/thread-list-model.ts`、`src/App.tsx` 与 `src/features/conversation/ConversationPage.tsx`；补充模型、对话与浏览器回归测试。

**接口：** `pathBasename(path: string): string` 返回末级非空路径片段，无法提取时返回空字符串；调用方决定本来就存在的备用文字。

- [x] 运行当前测试套件，记录 Windows 环境已有失败。
- [x] 为 Windows、UNC、混合分隔符、尾部分隔符与原始 cwd 保留添加测试；观察原代码返回完整路径的断言失败。
- [x] 新增共享函数，替换三个入口的仅 `/` 分割逻辑。
- [x] 运行回归测试、完整 `npm test` 与 `npm run build`，检查差异。
- [x] 完成独立代码审查，未发现实质问题。

代码交付按中文提交规范提交推送，提交信息由交付回复提供。

## 任务 2：双端发布

- [ ] 读取 Android、iOS 固定清单，排队分配统一更高版本。
- [ ] 在可用构建机的任务 worktree 构建 APK；使用本机私有配置构建、签名并发布同版本 IPA。
- [ ] 依最新版 SignOs 发布说明更新软件源，保留原开发者署名。
- [ ] 用固定清单、HEAD 和完整 GET 校验双端版本、大小和 SHA-256，交付 OTA 与固定下载地址。

## 环境记录

- 主工作区为 Windows，未配置该 Mac 的 SSH 别名。
- Android、iOS 固定清单均返回空响应；SSH TCP 端口可连接，但协议握手被远端关闭。仍需可达的 macOS 构建与发布环境，不能用未签名 IPA 替代。

## 验证记录

- 修改前相关两文件共 38 项测试通过；补充测试后 10 项断言失败，直接复现完整 Windows 路径与尾部分隔符显示问题。
- 修改后列表模型、列表组件、无项目与对话详情共 82 项测试通过。
- 手机尺寸 Chrome 浏览器回归通过：四类路径显示短名称；选择 UNC 项目并发起模拟聊天时，`thread/start` 的 `cwd` 仍为完整原路径。
- `npm run build` 通过 TypeScript 与 Vite 构建；保留原有大资源块提示。
- 修改前全量：846 通过、53 失败、3 跳过；修改后全量：859 通过、53 失败、3 跳过。两个日志中的失败名称完全一致，没有新增失败。

| 修改前后相同的失败文件 | 数量 |
| --- | ---: |
| `tests/ci/ios-attachment-picker.test.ts` | 3 |
| `tests/ci/ios-local-build.test.ts` | 4 |
| `tests/ci/portrait-orientation.test.ts` | 5 |
| `tests/server/bark-notifications.test.ts` | 41 |

原生检查包含 Windows 路径格式、脚本提取与 Python 命令缺失问题；Bark 测试存在原有注册/推送断言失败。本次未修改这些模块。

本地完整证据保存在任务 worktree 的 `.mobile-build/windows-project-name/`。测试接口均为离线模拟，没有创建需要归档的真实会话。未完成 APK/已签名 IPA 构建发布及真机覆盖安装验证。
