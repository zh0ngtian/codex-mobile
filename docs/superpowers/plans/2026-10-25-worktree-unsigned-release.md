# worktree归属、GitHub-only发布与网关部署收尾

按superpowers计划、TDD、先规格后质量审查及分支收尾流程执行。最终范围以用户最新要求为准：Android仅GitHub Release；iOS仅GitHub unsigned IPA及既有软件源；停止本机签名、固定LAN包更新与OTA。原阶段计划已按实际结果整合如下，旧提交保留当时过程。

## 基线与范围变化

- 初始main基线 `30db425fb265902b174fc80515e025a80c85b780`；主工作区本地main `7772b28f5e716d8e5e3759fb1e84a089158502ec` 的既有暂存内容保持。
- 用户先停止iOS签名／OTA，随后在批次运行中停止Android LAN。旧0.3.37批次 `d9ecccee-0825-4e20-94a3-6c3f16ff559d` 按原合同failed保留，未执行LAN阶段；它是范围被覆盖，不是成功或被新目标恢复。
- GitHub-only来源 `f2922453e967ad5b0af8f4f421d25d180b3d0001`，0.3.38批次 `c2997b88-4cc4-4298-b292-6cd3b4a3d70b` 附件／软件源已发布，但最终下载TLS连接中断被旧分类记为永久失败。冻结 `50f5a31ed9338682a668fa92b4db5a4974b2b3d1` 与失败记录不修改、不resume。
- 关联修复来源 `1f57555044a7e1d389cc30455b4ee1441cd62593`；同项目修复任务重新冻结并构建0.3.39，原任务已recovered，原失败批次保持failed。

## 已完成

- [x] 在独立工作区完成worktree映射、统一五条分页、刷新与搜索，真实执行cwd保留；功能回归、页面流程、Swift桥接及必要验证构建通过，真实只读列表回验无测试会话创建。
- [x] 发布策略规定iosDistribution=unsigned-only、androidDistribution=github-only；新目标精确为codex-mobile-github-only，四阶段main/build/source/verify，共享codex-mobile-main-production锁；拒绝旧LAN／签名／OTA入口，历史合同保留。
- [x] Github-only新增13项Python及7项冻结合同先RED后GREEN；prepare不依赖LAN／签名配置，verify独立下载GitHub双端并同步既有unsigned软件源，保留原开发者并追加当前账号。
- [x] TLS窄修复新增5项先RED后GREEN：仅curl35且明确SSL_ERROR_SYSCALL in connection to非空目标可作为只读暂时故障；GET／HEAD有界，写命令／POST不重试，永久证书／配置／权限／本地写入错误优先，不绕过TLS。
- [x] 最终261项Python、151项构建契约、类型检查通过；未变协调器复用59项核心恢复回归；先规格后质量审查均PASS。日志已保存至本机长期验证目录。
- [x] 来源分支推送并核对固定SHA，官方releasectl登记、heartbeat、ready及关联修复，协调器整合main、版本分配、冻结和正式发布，参与heartbeat在成批后停止。
- [x] 客户端成功批次 `38e51b86-291f-4761-b32e-8fe88448e82e`，0.3.39／3039，冻结 `ce9234e16aac975cc040117aa4bb257e135af3dd`；正式／开发CI与共同receipt已核对。旧包没有借用为新冻结产物。
- [x] 网关成功批次 `8574742b-24e0-4a42-8150-77d543498280`，冻结 `dfb0d11b01b1c3e3d71521f2c3d2fc8f5a64e6e9`；实际文件、进程、监听、认证健康及真实worktree映射通过。后续仅发布脚本／测试／文档变化，运行源码零差异且网关冻结是客户端冻结祖先，不重复部署。
- [x] 独立69项回验通过：完整GitHub APK／unsigned IPA、软件源普通／legacy、中文日志／署名、版本／大小／SHA-256、CI身份及attempt；8765／8766无监听且disabled，历史LAN／OTA文件未变。
- [x] 生成脱敏公共凭证并同步README、文档索引、交互约定与发布协调说明；仅文档收尾按共享main互斥推送，不触发再次构建／部署。

## 验收边界与凭证

[公共凭证](evidence/2026-10-25-worktree-github-release.json)记录两个成功批次、冻结来源、receipt摘要、CI与下载链接及包大小／SHA-256。iOS为未签名IPA；不提供停用的LAN或OTA入口作为现行交付。

未进行新版本真机安装、数据保留或现场视觉验收；已有桌面上传计量激活、真实Bark送达与原生文件入口仍待现场确认。Android旧LAN更新检查不可用，用户从GitHub手动下载，本次未实现GitHub自动更新。本次没有创建真实测试会话；工作区由宿主保留，不强制移除。
