# 发布查询故障恢复计划

用户已批准将查询未知与确认失败分开：网络故障保留原批次、冻结 SHA、版本和 CI run ID，恢复后只完成缺失步骤。配套通用协调器升级至 0.1.7，实施与故障验收主计划在 release-coordinator 仓库 `docs/superpowers/plans/2026-10-19-network-query-recovery.md`。

- [x] 先运行现有发布 Python 回归，建立干净基线。
- [x] 用 RED 用例复现 GitHub 重试耗尽后被当作永久失败，以及只读下载断线。
- [x] 引入明确的只读暂时故障类型，入口输出 `done:false` 与 `retryable:{kind:"transient-read",reason:脱敏原因}`；永久错误仍失败，POST 不盲目重试。
- [x] 保留 CI run/attempt、部分下载与完整校验；重启/恢复不重新分配版本或重建。
- [x] 与新版核心进行故障注入，核对同一批次/SHA/版本/run 和单次构建；覆盖响应丢失、重复查询、真实失败与来源散列错误。
- [x] 独立规格/质量审查，运行完整发布回归并提交推送 main。
- [x] 更新协调说明和验收记录，核对本机新核心运行状态。

范围仅为发布适配脚本、测试和文档，不涉及客户端/网关运行源码；不登记客户端发包批次、不构建或发布 APK/IPA、不部署网关、不创建新业务测试会话。既有失败批次及发布历史保持不可变。实现遵循 TDD，原服务升级前备份并等待活动批次结束。

## 已完成

通用协调器`99c518e3d1f49d93a74129f5eff338030bdedb21`已推送main并安装为0.1.7，原LaunchAgent登录启动、owner-only socket、状态库、6份项目配置保留。升级前无活动批次或就绪任务，升级后原72批次/81任务/6项目数据库行及旧runtime逐项一致。

本项目适配器最终审查源码`d4b31c1c9c1045e8b6587b7f46772507339bd04d`已在`e5ca9b5c64a04680c05b11704cf3af3038ccb141`整合并推送main，保留并行任务已有的侧栏设置。新增36项恢复回归先RED后GREEN，全量203项通过（10.033秒）；核心全量59项及四组GitHub CI通过。规格与质量复审发现的候选完整性、真实gh响应头和嵌套POST错误覆盖均已关闭。

最终联合验收使用已安装不可变runtime和本项目真实适配器CLI，本地HTTP真实断连后进入recovering，再重启实际协调器服务进程并恢复网络；同一批次/版本/冻结SHA/CI run成功完成，prepare和外部构建次数均为1。只使用临时状态库与模拟产物，未创建真实App批次、业务会话、APK/IPA或GitHub Release。已有固定APK/IPA保持0.3.11及原散列。

本机长期证据：`ReleaseCoordinator/validations/network-query-recovery-20261019/`，含`validation-summary.json`、`joint-final-green.json`、`installation-verification.json`、故障日志和升级备份。上游[0.1.7部署验收](https://github.com/zh0ngtian/release-coordinator/blob/main/docs/deployments/2026-10-19-0.1.7.md)记录原服务升级和验证边界。
