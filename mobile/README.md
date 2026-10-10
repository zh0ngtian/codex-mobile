# 本地移动端构建

GitHub Actions 工作流已移除。`android/build-recipe.yml` 与 `ios/build-recipe.yml` 保留原有固定 PakePlus 容器、工具版本及构建脚本，不包含自动触发、云端签名、artifact 上传或发布任务。

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

固定渠道发布要求见 [仓库约定](../AGENTS.md)。迁移构建配置未改变原生补丁或安装包内容，不需要为本次 Actions 移除重新发布 APK/IPA。
