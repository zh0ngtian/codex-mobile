# WebUI 正文图片修复部署计划

> 执行方式：Superpowers 计划、TDD、子任务实现与独立审查。

目标：把已修复的 Markdown 本地图片路径解码逻辑部署到现有 WebUI，回验目标对话九张正文图片。用户已明确允许给现有网关协调器增加显式 WebUI 更新选项；不发布 APK／IPA。

基线：`987b635ded684aab6c1fccb3f8eb4a18445a55c6`。任务：`web-markdown-images-update-20261115`，目标：`codex-mobile-gateway-production`。在独立 worktree 开发，保留主工作区未提交内容。

## 1. 先测试，再实现可选 WebUI 构建与安装

- [x] 在 `tests/ci/test_gateway_release_adapter.py` 先新增失败测试：冻结任务验证记录中 `webUi=true`、`scope=gateway-only`、`sourceCommit=task.sha` 时构建并替换 `dist`；未选择时仍保留原前端。
- [x] 覆盖错误类型、SHA／scope 不符、多个任务显式选择冲突；构建失败不安装，前端源码／产物／日志漂移拒绝复用，响应丢失可恢复且不重复构建。
- [x] 在 `scripts/release_coordination/gateway.py` 实现该 opt-in。缺省保持旧身份、旧服务端构建命令和检查点兼容；启用时身份及回执明确记录 `webUi=true`。
- [x] 启用时从冻结 worktree 清理并执行 `npm run build`，前端输入指纹覆盖 `src`、`public`、`index.html`、Vite／TypeScript 配置与依赖清单；持久化成功构建日志及 `dist` 摘要，再快照安装。服务端照旧构建。旧依赖、启动文件、环境配置继续保留，原备份与原子切换／恢复机制继续生效。
- [x] 跑网关适配器回归；独立规范审查和质量审查通过。

## 2. 文档和发布门禁

- [x] 更新 `docs/release-coordination.md` 当前网关合同与任务验证示例；更新 `docs/interaction-alignment.md` 当前要求、验收要点和变更记录，部署前标记待验收。
- [x] 执行协调器要求的 adapter-regression、coordinator-recovery、build-contract、typecheck；执行图片 UI 回归和 Web 构建。
- [x] 阅读提交约定后提交中文 Conventional Commit，推送固定 SHA。检查最新远端 main，若有更新则整合并对相关范围回归。

## 3. 现役协调器部署和真实回验

- [x] 使用私有 validation JSON 绑定固定 SHA、`scope=gateway-only`、`webUi=true` 和四项检查结果，向已登记任务提交 ready。
- [x] 持续 heartbeat／等待现役协调器冻结、main、gateway、verify 完成；不绕过共享 main 锁，不修改失败冻结现场。
- [x] 核对成功 receipt 的冻结 SHA、任务包含证据、WebUI 标记、文件摘要、真实新 PID 和认证健康状态；保留私有信息在仓库外。
- [x] 刷新现有网站，确认目标对话九张正文图片实际加载、可预览；原始已缺失的上传附件单独如实记录。
- [x] 将公共验收证据和文档状态更新到已验证，提交推送 main；文档收尾复用成功部署，不重复构建或部署。

验收边界：修复可访问的九张正文图片；已从磁盘删除的历史上传原件不属于可恢复范围。本次不创建测试会话，不操作用户目标会话的归档状态。

最终验收：成功批次 `2df6c58f-70f6-4186-9bc7-4398702bd9cd`，冻结 `ac6132c2668e4de2490905f9ad785de0095e4a38`。九张正文图片与总览原图预览、下载路径均已通过现役网站回验。[公共证据](evidence/2026-11-15-webui-image-deploy.json)。
