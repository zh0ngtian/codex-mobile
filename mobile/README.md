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

## GitHub 自动双端构建

`main` 的客户端、共用构建入口和配置变更自动触发 `Build Mobile Apps`；也可以在 Actions 中手动运行，`release_version` 留空自动分配，填写时必须高于已用版本。工作流串行分配发布版本，同一次运行内 Android/iOS 并行构建，两端成功后才创建 Release。文档和服务端单独修改不触发，npm 不自动发布。

版本计算读取全部 GitHub Release 标签（包括临时 `unsigned-ipa-<version>-<run>-<attempt>`）和 `mobile-version-floor.json`，选择最大版本后递增。GitHub 无法读取局域网清单；本机固定渠道超前时应先同步版本下限或手动指定更高版本。

本地预检入口：

```bash
node scripts/build-mobile.mjs --platform android --version 0.2.148 --plan
node scripts/build-mobile.mjs --platform ios --version 0.2.148 --plan
```

实际构建省略 `--plan`。Android 入口需要 Linux、Node.js 22.14.0、pnpm 10.34.6、JDK 17、Android SDK 与 recipe 中的工具；iOS 使用 macOS、Xcode 26.3，并复用 `ios:prepare` 的工程和图标准备。每次使用独立干净构建目录。产物位于 `.mobile-build/artifacts/`，包含安装包、SHA-256 和来源提交/大小回执。云端 APK 沿用当前 debug 构建签名，IPA 明确为未签名产物。

GitHub Release 产物与正式本机渠道分别交付。iOS 正式发布仍需本机 Ad Hoc 签名、HTTPS OTA 和固定 LAN IPA 验收；软件源只同步本仓库 GitHub Release 的 unsigned IPA，交付时单独核对版本。Ad Hoc 已签名包不再发布到软件源，unsigned IPA 不能覆盖已签名固定渠道。
