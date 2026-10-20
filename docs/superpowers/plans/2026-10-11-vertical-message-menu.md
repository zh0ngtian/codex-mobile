# 原生菜单直接纵向展开

目标：仅调整长按菜单，所有操作直接纵向显示，不分页、不增加子菜单；保留现有消息布局和编辑流程。

实现：iOS 17.4+ 使用 UIButton 的原生 UIMenu 与 performPrimaryAction，根菜单只包含 UIAction；iOS 16–17.3 使用系统纵向 action sheet。Android 与网页现有纵向平级菜单保持原样。

- [x] 为原生菜单验收添加动作纵向排列和会话六项操作同时可见断言，先复现现有横向菜单失败。
- [x] 将 iOS UIEditMenuInteraction 换为平级纵向原生菜单；保持请求隔离、取消、剪贴板与编辑键盘。
- [x] 通过原生模拟器验收、相关 Vitest、类型检查和双端构建。
- [x] 中文提交推送，排队选择更高统一版本，发布 APK、签名 IPA、OTA 与现役软件源并完成回验。
- [x] 保存凭证、推送验收记录、清理专用模拟器和临时工作区。

## 验收与发布

源码提交 `95c3243acaab4e21b33c56227a23ac1541c6077b` 已推送。仅修改原生长按菜单及其验收代码，没有修改消息布局或其它 UI。根菜单操作平级纵向排列，不出现分页或二级菜单；使用 UIKit 公共 API。

旧横向菜单在两项新增排列断言下失败。修改后相关 Vitest 55 项通过，类型检查通过；原生模拟器验收 2 项通过、0 失败，命令正常退出。已检查消息“编辑、复制”纵向排列，会话六项操作全部直接可见，复制、编辑内容与键盘、点击外部关闭和重新打开均通过。

本次使用内存 fixture，没有创建真实网关测试会话。专用模拟器已删除；未验证真机覆盖安装和数据保留。

固定渠道排队取得发布锁后，核对原双端版本为 0.2.149，统一发布 0.2.150。Android 正式构建、iOS 设备构建及 Ad Hoc 签名验签通过。固定 JSON、HEAD 和完整 GET 的版本、大小及 SHA-256 一致；HTTPS OTA 安装页和清单通过配置 CA 验证。

[固定 OTA 安装页](https://192.168.123.79:8766/channels/codex-mobile/current/install.html)

| 产物 | 版本 | 大小（字节） | SHA-256 |
| --- | --- | --- | --- |
| [APK](http://192.168.123.79:8765/channels/codex-mobile/latest.apk) | 0.2.150 | 4,714,611 | `419ddbaa198bff6390022b1b7b02b3bf9cb3b6253089854e4fc1f068c49200ea` |
| [IPA（Ad Hoc 已签名）](http://192.168.123.79:8765/channels/codex-mobile/latest.ipa) | 0.2.150 | 3,783,849 | `cfb6c5a4aaae3cae93bbc6338aea426377254bd645177b0e9eed4a7ec9aee7e8` |

iOS 保留 Bundle ID `vip.loock.codexmobile`、application-identifier `SC456JW7RP.app.jade6694.grapefruit3766` 及兼容基准的权限和钥匙串组。现役软件源流程按 SignOs 最新 `distribution/app-source/PUBLISH_PROMPT.md` 执行，上传同一签名 IPA；软件源版本 0.2.150、buildNumber 2150，完整下载大小与散列一致。保留已有开发者署名 `loock-ai / zh0ngtian / Roxbili`。

长期证据保存在主工作区 `.mobile-build/vertical-menu-release/0.2.150/`，包含双端安装包、签名报告、发布清单、软件源回执、验证 JSON、原生测试结果与截图。交付收尾归档专用 worktree、删除本次临时容器与临时文件，并释放固定渠道发布锁。
