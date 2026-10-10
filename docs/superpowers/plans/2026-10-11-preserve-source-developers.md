# 软件源开发者追加规则

目标：发布时读取当前 GitHub 登录名，保留目标 App 的全部既有开发者署名；仅在缺少该用户名时追加。

实施顺序：

1. 在 `tests/ci/test_ios_app_source.py` 先补充缺失追加、重复不变、大小写去重、相似名称不误判和 GitHub 身份读取失败的测试，确认旧实现失败。
2. 在 `scripts/ios_app_source.py` 通过 `gh api --hostname github.com user --jq .login` 读取当前账号；从最新软件源目标 App 的 `developerName` 合并署名，再传入 SignOs 发布器。上传前核对合并结果，禁止覆盖旧署名。
3. 更新 `AGENTS.md` 与 `docs/ios-ota-release.md`，替换固定署名规则，说明正式发布和补发一致。
4. 运行软件源及 iOS 入口回归测试，检查 diff，按仓库规范提交并推送。此次不构建或上传安装包。

验证：28 项软件源与发布入口测试通过；包含重复追加、不同分隔格式、实际账号读取失败和上游错误覆盖署名时阻止上传。

用户额外授权：本次一次性移除 Codex Mobile 源条目的 `Yao`（同一用户旧署名），保留其他开发者并补上当前 GitHub 用户名。仅修改 `developerName`，不改版本、安装包、历史记录或其他应用；持有共享发布锁，先保存并核对公网/R2 基线，上传后回验两端。此清理不写入日常自动发布逻辑。
