# 软件源发布引用上游文档

目标：软件源发布统一读取 [SignOs PUBLISH_PROMPT.md](https://github.com/zh0ngtian/SignOs/blob/main/cloudflare/app-source/PUBLISH_PROMPT.md) 最新版，本仓库不维护其具体流程。

- [x] 调整发布入口测试，先确认旧实现仍强制依赖软件源上传器而失败。
- [x] 删除本地软件源上传器及命令；保留 OTA/LAN 完整回验后的签名包、凭证和外部文档入口。
- [x] 清理现役文档和历史计划中的流程副本，保留开发者署名追加要求。
- [x] 运行发布入口测试、只读预检和差异检查；本次不构建或发布安装包。

验证：11 项发布入口测试通过；真实私有配置的 `ios:release --plan` 通过，保留既有签名身份并返回上游文档链接和软件源待发布状态。`git diff --check` 通过。
