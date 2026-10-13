# 移动端构建

GitHub Actions 与本地构建共用 `android/build-recipe.yml` 和 `ios/build-recipe.yml` 中的固定 PakePlus 容器、工具版本及构建脚本。recipe 只描述构建步骤，自动触发、artifact 上传与 GitHub Release 发布由 `.github/workflows/build-mobile.yml` 管理。iOS 云端构建不读取本机签名材料。

配置字段：

- `env`：应用名称、标识等默认环境值。
- `container`：PakePlus 仓库与固定提交 SHA。
- `tools`：构建工具版本与配置，需在本机准备相应依赖。
- `steps`：有序 shell 步骤，`working-directory` 相对于构建目录；无该字段时使用仓库根目录。

## iOS

```bash
npm ci
npm run ios:prepare -- --plan --version 0.2.123
npm run ios:prepare -- --version 0.2.123
```

准备脚本读取 iOS 配置，安装前端与原生补丁，并在本地生成图标。正式构建、签名与 OTA 发布使用 `npm run ios:release`，详见 [iOS 发布文档](../docs/ios-ota-release.md)。示例版本仅演示参数格式，正式发布必须高于双端渠道现有版本。

## Android

Android 配置保留原有构建步骤，供本机打包时读取；配置文件本身不会自动执行。
在独立构建目录按 `container` 检出固定版本到 `pakeplus/`，安装 `tools` 中的 Node.js、pnpm、JDK 与 Android SDK，并准备 ImageMagick。`Install ImageMagick` 是 Linux 安装命令，macOS 应预先安装对应工具。

执行步骤前设置 `APP_VERSION`、`APP_VERSION_CODE`、`RUNNER_TEMP`，并注入 `env` 中的默认值。`APP_VERSION_CODE` 沿用 `major * 1000000 + minor * 1000 + patch`；`minor` 和 `patch` 必须小于 1000，结果须为正数且不超过 2100000000。`RUNNER_TEMP` 指向本次构建的临时目录。按照配置顺序执行前端、原生生成、硬化、Gradle 构建与 APK 校验步骤。

固定渠道发布要求见 [仓库约定](../AGENTS.md)。

## 冻结批次双端构建

客户端任务通过本机 `releasectl` 登记并提交 ready；prepare 预留统一版本，整合验证后冻结清单。正式 `Build Mobile Apps` 只由 main 的 `.release-batch.json` 变化触发，使用稳定作用域、`cancel-in-progress: false`、`queue: max`；gateway 批次跳过客户端产物。开发/PR检查另组，普通任务推送、文档修改不发布。

CI 校验清单引入提交、任务祖先、目标、版本和构建号，再构建 Android APK 与 iOS unsigned IPA，两端同 run 成功后创建同一 Release。手动运行仅用于匹配已冻结批次的 batch ID、最终 SHA 和版本，不分配新版本、不重复触发同批。回执包含任务、来源 SHA、batch/run/attempt、大小和 SHA-256。

版本分配保留原规则，由 prepare 对账全部 GitHub 标签、仓库下限和 LAN/OTA，而不是 CI 与本机分别递增。配置、必要验证、共同凭证与中断/关联修复操作见 [发布协调说明](../docs/release-coordination.md)。

本地预检入口：

```bash
node scripts/build-mobile.mjs --platform android --version 0.2.148 --plan
node scripts/build-mobile.mjs --platform ios --version 0.2.148 --plan
```

实际构建省略 `--plan`；正式发布构建由批次协调入口统一触发，开发阶段仅执行必要本地验证。Android 入口需要 Linux、Node.js 22.14.0、pnpm 10.34.6、JDK 17、Android SDK 与 recipe 中的工具；iOS 使用 macOS、Xcode 26.3，并复用 `ios:prepare` 的工程和图标准备。每次使用独立干净构建目录。产物位于 `.mobile-build/artifacts/`，包含安装包、SHA-256 和来源提交/大小回执。云端 APK 沿用当前 debug 构建签名，IPA 明确为未签名产物。

GitHub Release 产物与正式本机渠道分别交付。iOS 正式发布仍需本机 Ad Hoc 签名、HTTPS OTA 和固定 LAN IPA 验收；软件源只同步本仓库 GitHub Release 的 unsigned IPA，交付时单独核对版本。Ad Hoc 已签名包不再发布到软件源，unsigned IPA 不能覆盖已签名固定渠道。
