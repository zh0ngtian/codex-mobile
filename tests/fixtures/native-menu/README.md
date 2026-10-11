# 原生菜单模拟器验收

这个页面使用真实 `TurnCard` 与 `ConversationActionMenu`，数据仅保存在内存，不连接网关，不创建真实会话。

在独立 worktree 准备普通 iOS 工程后，执行：

```sh
npm exec -- vite build tests/fixtures/native-menu --config tests/fixtures/native-menu/vite.config.ts --outDir "$PWD/.mobile-build/native-menu-fixture"
cp -R .mobile-build/native-menu-fixture/. .mobile-build/ios/pakeplus/PakePlus/
python3 - <<'PY'
from pathlib import Path
p = Path('.mobile-build/ios/pakeplus/PakePlus/index.html')
p.write_text(p.read_text().replace('./assets/', './'))
PY
ruby scripts/configure-ios-tests.rb .mobile-build/ios/pakeplus/PakePlus.xcodeproj "$PWD/mobile/ios/ActionMenuUITests.swift"
```

取得主工作区的 `.mobile-build/.ios-simulator.lock` 后，运行 `CodexMobileUITests/ActionMenuUITests`，覆盖系统菜单复制、原位置编辑及键盘、会话置顶和重新打开菜单。iOS 容器将 assets 目录打平，因此验收 HTML 与正式构建一样必须改用 `./` 资源路径。

验收工程含测试页面，不能发布。正式签名发布必须重新运行 `npm run ios:release`，它会从正式源码重新生成工程。
