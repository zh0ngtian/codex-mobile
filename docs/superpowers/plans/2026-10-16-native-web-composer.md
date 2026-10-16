# iOS 网页原生输入框实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 iOS 的旧版和新版网页对话中复用现有 SwiftUI `NativeComposerView`，增加独立的“使用原生输入框”开关，保留“使用原生界面”整页开关及现有业务行为。

**Architecture:** 整页模式与输入区模式分别冻结于进程启动，分别保存到 UserDefaults；独立输入开关默认开启，保存后下次完整启动生效。React、`BackendWorkspace` 和唯一 `NativeRuntime` 继续拥有业务状态，Swift 只呈现快照、保存未确认编辑并发送已有命令；混合模式显示同一个业务 WKWebView 和一个原生输入区。`ConversationPage` 显式登记当前输入区的呈现条件，原生栏回传实际几何位置供网页历史预留空间。

**Tech Stack:** React 19 / TypeScript、现有 NativeRuntime v1 协议、SwiftUI / Observation、WKWebView、Vitest / Testing Library、真实 Swift fixture、XCTest。

---

## 范围、约束与调查结论

- 工作区：`/Users/zhongtian/.codex/worktrees/ios-native-composer/codex-mobile`；分支：`codex/ios-native-composer-20261016`；调查基线：`origin/main` 的 `a815b89`。执行前重新核对 HEAD 与未提交变更，不覆盖其他任务的文件。
- 本文件只是计划。计划编写者不写生产代码、不提交、不推送、不构建或发布。实现和验收由后续执行者完成。
- 用户已经批准复用现有输入栏及增加独立开关；不再讨论输入栏重做、第二个 WebView、第二套 transport 或其他产品方案。
- 全原生模式保持 `NativeRootView → NativeConversationView → NativeComposerView` 原有路径。输入区开关只决定网页模式的输入区；两个开关都打开时，全原生模式优先，不能再叠加混合输入区。
- 普通浏览器、Android、外部 URL、iframe、其他 `file:` 页面均不启用此能力。保留 `NativeUITrust` 原始 bundle URL 的 JS 精确比较与 Foundation 原生标准化比较，尤其不能破坏 `/private/var` 路径。
- `BackendWorkspace` 为所有设备保持挂载，非当前设备用 `hidden` 隐藏；因此 `ready`、`active != null` 或“有 workspace”都不能作为输入区可见性依据。使用已有 `conversationVisible` 和 `ConversationPage` 的真实挂载登记。
- 现有 `NativeComposerView` 包含文字、附件、发送/停止、队列、模型/思考强度/速度/权限；`NativeAttachmentOptionsView` 含照片、文件、Skill/Plugin、位置。命令继续回到 `createWorkspaceAdapter` 和 App 已有回调。
- 现有网页 form 还承载只读提示、附件处理状态、保存新对话草稿和待引导状态，不能随 form 一起丢失。新对话设备/项目选择位于网页历史区，继续显示；队列编辑使用已有原生 panel 命令。最大化在同一个原生输入控件内实现，不恢复网页 form，不开启第二个编辑器。
- `ConversationPage` 定义了 `RealtimeControls`，当前代码没有 `realtime.start()` 的可达按钮。保留已有 hook 和活动时的控制层，不新增语音入口；如果活动状态通过现有路径出现，收起原生输入区并保留网页结束/静音控制。
- 生成容器的 legacy child 已是 `.ignoresSafeArea(.container, edges: [.all])`。不能仅给父级加 `safeAreaInset` 后假定 WebView 已缩小；本方案采用覆盖输入栏与实测遮挡位置，不重复加键盘高度或 home indicator 高度。
- 已有父任务基线：128 个文件、1448 项测试通过；日志为 `~/Library/Application Support/CodexMobile/validation/native-composer-20261016/baseline.log`。后续必须保留新增测试的 RED 和 GREEN 记录，不能把这份基线当作新功能通过。

## 状态与数据流合同

| 数据 | 唯一拥有者 | 原生侧职责 |
| --- | --- | --- |
| 对话、线程、队列、模型、权限、附件对象及网络请求 | 现有 React / BackendWorkspace | 显示 DTO，发送显式白名单命令 |
| 已确认草稿与 UTF-16 光标 | React adapter / NativeRuntime | 按 `contextId + draftRevision` 保护尚未确认的本地输入 |
| 中文组字、键盘焦点、最大化、模型/附件调节 sheet | 当前原生输入控件 | 不生成业务副本，不把组字被回显打断 |
| 全原生偏好 | `codexMobile.useNativeUI` | 原值、默认关闭和下次完整启动语义保持 |
| 网页原生输入偏好 | `codexMobile.useNativeComposer` | 默认开启；保存失败回滚；下次完整启动生效 |
| 当前网页是否可呈现输入区 | ConversationPage + App/公共遮罩登记 | 根据快照呈现，隐藏时失焦，不能抢占网页弹层 |
| 网页历史底部留白 | 当前 ConversationPage | 将原生实际几何位置换算为 CSS 遮挡量 |

启动顺序：宿主冻结两个偏好 → 可信 bundle 注入两个独立 flag → `isNativeBridgeEnabled()` 决定是否创建一个 NativeRuntime → React 完成 workspace 与呈现登记 → Swift 接收快照 → 混合输入栏覆盖网页底部 → 输入栏几何探针经同一可信桥回传位置 → 当前网页滚动区更新底部留白。

编辑顺序：原生修改文字/光标 → `draft.set(value, revision, caretOffset, contextId)` → 同一个 runtime 校验、占版本并调用现有 `setDraft` → React 布局提交更新 adapter → 快照确认 revision → 原生收敛。发送不传另一份业务草稿；发送、队列和停止仍调用已有 `message.send` / `queue.*` / `turn.stop`。停止不等待慢发送完成。

呈现优先级：全原生根 > 网页全局/局部弹层 > 原生输入动作产生的 sheet > 混合输入栏。普通网页遮罩出现时，只收起原生栏，不显示网页输入框；关闭遮罩后显示原生栏，但不自动弹出键盘。用户主动“使用旧界面恢复”才调用既有 recovery；不能因超时自动切换输入实现。

## 文件职责

| 文件 | 改动与责任 |
| --- | --- |
| `src/native-ui/runtime.ts`、`adapters.ts` | 区分完整原生呈现与桥能力；仍只创建一个 runtime；登记输入区 presentation |
| `src/native-ui/protocol.ts`、`mobile/ios/NativeUI/NativeSnapshot.swift` | 增加可选 `webComposer` 纯展示 DTO |
| `src/native-ui/web-composer.ts`（新建） | 混合能力判定、presentation hook、几何事件和 CSS 遮挡换算 |
| `src/native-ui/preference.ts`、`switch-context.tsx` | 给现有检查点事务增加独立 composer 偏好，保留原接口兼容 |
| `src/ui/overlay-scroll.ts` | 复用已有层登记，提供只读遮罩订阅；不靠 DOM 选择器猜测模态 |
| `src/App.tsx` | 传递真实 `nativeContextId`、`conversationVisible`；全原生的全局面板仍单独路由 |
| `src/features/conversation/ConversationPage.tsx` | 真实挂载/可见/遮罩登记；移出辅助状态；条件移除 Web form；保留网页历史及业务弹层 |
| `src/native-ui/workspace-adapter.ts` | 区分原生动作 panel 与网页自己的历史编辑/审批，防止两边同时呈现 |
| `src/features/backends/BackendManagerSheet.tsx`、`ModernSettingsRoot.tsx`、`src/i18n.tsx` | 两套网页设置均增加独立开关及错误/生效说明 |
| `mobile/ios/NativeUI/NativeUIPreference.swift`、`NativeUIStore.swift`、`NativeUIBridge.swift`、`NativeUITrust.swift` | 默认、冻结、存储回滚、可信桥、几何回传 |
| `mobile/ios/NativeUI/NativeWebComposerHost.swift`（新建） | 复用输入栏、mentions、原生动作 panel；与网页其他区域无关 |
| `mobile/ios/NativeUI/NativeComposerLayoutProbe.swift`（新建） | 通过同一个业务 WebView 的坐标换算回传输入栏实际顶部 |
| `mobile/ios/NativeUI/NativeUIHost.swift`、`NativeComposerView.swift`、`NativeSettingsView.swift` | 混合挂载、仅混合启用的最大化展示参数、两种原生偏好控件 |
| `mobile/ios/KeyboardDismissal.swift` | 混合输入时不再驱动已不存在的网页 `.composer-wrap` 动画 |
| `tests/ui/native-ui-web-composer.test.tsx`（新建） | 真正渲染 ConversationPage / runtime 的混合行为回归 |
| `tests/ci/native-ui-web-composer-smoke.swift`（新建）、`tests/ci/ios-native-ui.test.ts` | 真实 Swift 状态、偏好、DTO、脚本执行；不只匹配源码字符串 |
| `tests/ui/native-ui-runtime.test.ts`、`native-ui-adapter.test.tsx`、`native-ui-workspace.test.ts`、`web-interface-preference.test.tsx` | 复用已有真实行为测试入口 |
| `mobile/ios/NativeUIUITests.swift` | 模拟器实际 WebView/输入/键盘/弹层验收 |
| `README.md`、`docs/native-ui-business-bridge.md`、`release/notes.md` | 记录最终实际行为和用户可见变化；不写尚未完成的验收 |

这是一个紧密耦合的桥接集成。任务一包含完整可运行实现，内部按小步 RED→GREEN；任务二完成跨层和模拟器验证。不要按文件把同一数据合同拆给多个并发实现者。

### 任务一：完成网页与原生输入区的单一桥接集成

**Files:** 上述生产文件和对应 `tests/ui`、Swift smoke 文件。现有 `mobile/ios/build-recipe.yml` 已复制 `NativeUI/*.swift`，新增文件自然进入生成工程，不新增 WebView 构造入口或另一条构建路径。

- [x] **步骤 1：先增加能力与状态合同的失败测试。** 在 `tests/ui/native-ui-runtime.test.ts` 追加以下用例；在 `afterEach` 删除 `__CODEX_NATIVE_COMPOSER__` 和 recovery flag。

```ts
it('完整原生与网页原生输入分别启用同一个桥，普通环境和恢复状态关闭桥', async () => {
  const target = window as any;
  target.webkit = { messageHandlers: { nativeUI: { postMessage() {} } } };
  target.__CODEX_NATIVE_UI__ = false;
  target.__CODEX_NATIVE_COMPOSER__ = true;
  expect(isNativeUIEnabled()).toBe(false);
  expect(isNativeBridgeEnabled()).toBe(true);
  const runtime = new NativeRuntime(() => {});
  const writes: string[] = [];
  runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
  runtime.setWorkspace('b', workspace(), { 'draft.set': p => { writes.push(String(p.value)); } });
  runtime.listen();
  window.dispatchEvent(new CustomEvent('codex-mobile-native-command', {
    detail: command('mixed-draft', 'draft.set', { contextId: 'b:t', value: '混合草稿', revision: 1 }),
  }));
  await Promise.resolve();
  expect(writes).toEqual(['混合草稿']);
  target.__CODEX_NATIVE_UI_RECOVERED__ = true;
  expect(isNativeBridgeEnabled()).toBe(false);
  runtime.dispose();
});

it('仅当前页面的显式登记可以显示输入区，后台登记和旧context不能覆盖', () => {
  const runtime = new NativeRuntime(() => {});
  runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
  runtime.setWorkspace('b', workspace(), {});
  expect(runtime.snapshot().webComposer).toBeUndefined();
  runtime.setWebComposer('b', { contextId: 'b:t', visible: true, blocked: false });
  runtime.setWebComposer('c', { contextId: 'c:t', visible: true, blocked: false });
  expect(runtime.snapshot().webComposer).toEqual({ contextId: 'b:t', visible: true, blocked: false });
  runtime.setWorkspace('b', workspace('b:new'), {});
  expect(runtime.snapshot().webComposer).toBeUndefined();
  runtime.setWebComposer('b', { contextId: 'b:new', visible: false, blocked: false });
  expect(runtime.snapshot().webComposer?.visible).toBe(false);
  runtime.dispose();
});
```

执行 `npm test -- tests/ui/native-ui-runtime.test.ts tests/ui/native-ui-adapter.test.tsx`。预期新能力导出或新方法缺失导致 RED；补好测试 import 后，确认失败来自能力缺失。不要先写实现。

- [x] **步骤 2：实现最小能力和纯数据合同，再跑同一测试变绿。** `isNativeUIEnabled()` 只保持完整原生语义，不能把它改成 OR 导致新版网页样式被关掉。

```ts
// src/native-ui/protocol.ts
export interface NativeWebComposerPresentation {
  contextId: string;
  visible: boolean;
  blocked: boolean;
}
// NativeSnapshot 新增：webComposer?: NativeWebComposerPresentation;
```

在 `NativeWindow` 增加 `__CODEX_NATIVE_COMPOSER__?: boolean`，并加入：

```ts
export function isNativeBridgeEnabled() {
  if (typeof window === 'undefined') return false;
  const target = window as NativeWindow;
  return target.__CODEX_NATIVE_UI_RECOVERED__ !== true &&
    (target.__CODEX_NATIVE_UI__ === true || target.__CODEX_NATIVE_COMPOSER__ === true) &&
    typeof target.webkit?.messageHandlers?.nativeUI?.postMessage === 'function';
}
```

仅把 runtime 事件 listener、`publishNativeSnapshot`、`useNativeRuntime` 的可用判定替换成 `isNativeBridgeEnabled`；`WebInterfaceProvider`、完整原生前台判断等继续用原有完整呈现判断。`cachedRuntime` 仍只在首次挂载构造一次，StrictMode 仍只有一个 listener。

在 `NativeRuntime` 增加 `private webComposers = new Map<string, NativeWebComposerPresentation>()`，在 `dispose()` 清空。增加以下方法，并在 `snapshot()` 返回值中插入局部变量 `webComposer`：

```ts
setWebComposer(id: string, value?: NativeWebComposerPresentation) {
  const previous = this.webComposers.get(id);
  if (value) this.webComposers.set(id, value);
  else this.webComposers.delete(id);
  if (previous?.contextId !== value?.contextId || previous?.visible !== value?.visible || previous?.blocked !== value?.blocked) {
    if (!this.disposed) this.publish(this.snapshot());
  }
}
// snapshot() 内，已取得 workspace 后：
const presentation = this.webComposers.get(this.navigation.selectedBackendId);
const webComposer = presentation?.contextId === workspace?.value.contextId ? presentation : undefined;
```

`NativeSnapshot.swift` 对应增加 `var webComposer: NativeWebComposerPresentation? = nil`，新增值类型（与 snapshot 放同一文件即可）：

```swift
struct NativeWebComposerPresentation: Codable, Equatable {
    var contextId: String
    var visible: Bool
    var blocked: Bool
}
```

- [x] **步骤 3：先验证独立偏好默认、冻结与失败回滚，再扩展现有检查点事务。** `tests/ci/native-ui-preference-smoke.swift` 保留原用例，追加真实 UserDefaults 断言：

```swift
let composer = NativeUIPreference(defaults: defaults, storageKey: NativeUIPreference.composerKey, defaultEnabled: true)
precondition(composer.enabled, "输入区首次默认启用")
let frozenComposer = composer.enabled
try composer.save(false)
precondition(!composer.enabled && frozenComposer, "保存不能热切换当前输入实现")
precondition(!NativeUIPreference(defaults: defaults, storageKey: NativeUIPreference.composerKey, defaultEnabled: true).enabled)
let brokenComposer = NativeUIPreference(defaults: defaults, storageKey: NativeUIPreference.composerKey, defaultEnabled: true, synchronize: { false })
do { try brokenComposer.save(true); preconditionFailure("保存失败必须抛错") }
catch { precondition(!composer.enabled, "保存失败保留关闭偏好") }
precondition(!preference.enabled, "输入偏好不能修改整页偏好")
```

执行 `npm test -- tests/ci/ios-native-ui.test.ts -t 原生偏好`，观察 RED。随后把 `NativeUIPreference` 原有实例实现改成以下完整通用实现（保留类型名与原默认调用）：

```swift
struct NativeUIPreference {
    static let key = "codexMobile.useNativeUI"
    static let composerKey = "codexMobile.useNativeComposer"
    private let defaults: UserDefaults
    private let storageKey: String
    private let defaultEnabled: Bool
    private let synchronize: () -> Bool

    init(defaults: UserDefaults = .standard, storageKey: String = Self.key,
         defaultEnabled: Bool = false, synchronize: (() -> Bool)? = nil) {
        self.defaults = defaults
        self.storageKey = storageKey
        self.defaultEnabled = defaultEnabled
        self.synchronize = synchronize ?? { defaults.synchronize() }
    }
    var enabled: Bool { defaults.object(forKey: storageKey) as? Bool ?? defaultEnabled }
    func save(_ enabled: Bool) throws {
        let previous = defaults.object(forKey: storageKey)
        defaults.set(enabled, forKey: storageKey)
        guard synchronize() else {
            if let previous { defaults.set(previous, forKey: storageKey) }
            else { defaults.removeObject(forKey: storageKey) }
            _ = defaults.synchronize()
            throw CocoaError(.fileWriteUnknown)
        }
    }
}
```

`NativeUIStore` 增加 `static let launchComposerPreference = NativeUIPreference(storageKey: NativeUIPreference.composerKey, defaultEnabled: true).enabled`、`let composerEnabled: Bool`、`var savedComposerPreference`（读同一 key），在 init 冻结 `composerEnabled = !isReference && Self.launchComposerPreference`。测试用 debug launch override 只用于明确 `--native-web-composer-live`，不可改变正式默认或发布配置。

`preference.ts` 的请求 input 增加 `kind?: 'interface' | 'composer'`；旧调用省略 kind 仍为 interface。`NativeUIBridge` 对 `nativePreference` 消息的 kind 做显式白名单校验，`nil` 视为 interface，拒绝其他字符串；按 kind 构造对应的 `NativeUIPreference`。布尔值仍必须使用 `CFBooleanGetTypeID()` 校验。`completePreference` 的 `active` 分别回传该偏好的冻结值，保存只更新对应的 `saved…Preference`，不修改 `nativeEnabled` / `composerEnabled`。

`SwitchState` 增加 `composerEnabled: boolean` 和 `changeComposer(enabled: boolean): Promise<void>`。初始化用 `Promise.all([requestNativePreference(), requestNativePreference({ kind: 'composer' })])` 读取两个值。把原 `change(next)` 的事务提取为内部 `changePreference(kind, next)`，保留原 checkpoint 的 load → save → preference commit → armed 增量保存 → 失败 restore 顺序、共用 inFlight/pending 锁。具体提交行使用：

```ts
const saved = await requestNativePreference({ kind, enabled: next });
if (kind === 'interface') setEnabled(saved.enabled);
else setComposerEnabled(saved.enabled);
// Provider value 中：
change: (next: boolean) => changePreference('interface', next),
changeComposer: (next: boolean) => changePreference('composer', next),
```

原生设置同样经 `settings.native-composer` 进入这个事务，不能直接写 UserDefaults 绕过附件检查点。给 runtime 全局白名单/布尔校验和 `useNativeRuntime` 的注册各追加该命令，handler 为 `preference.changeComposer(params.enabled as boolean)`。

Swift store 的 composer 偏好请求沿现有 `requestNativePreference` 的实现追加 kind 参数，或提取该方法内重复状态；必须保留原有方法供界面测试调用。新增入口 `requestNativeComposerPreference(_:)`，发送 `settings.native-composer`；请求 ID、20 秒超时、桥执行失败和 commandResults 失败均能释放 saving 状态并显示可重试错误。两个开关共用 saving 锁，错误不会把另一个偏好改掉。

在 `web-interface-preference.test.tsx` 为两种 Web 样式追加：iOS 两个开关均存在；默认输入开启、完整原生关闭；关闭输入开关只发 composer kind；两个 flag 不热变；保存失败回滚；带图片/文件的 checkpoint 可恢复；Web/Android 无此开关。stub 只按消息 kind 返回相应偏好，不让未知消息被错误地完成。执行两套偏好测试变绿。

- [x] **步骤 4：先写真实页面的呈现失败测试，再接入显式 presentation 和公共遮罩订阅。** 新建 `tests/ui/native-ui-web-composer.test.tsx`，沿现有 ConversationPage 测试 fixture 渲染真实组件；从当前测试 fixture 导出共用 props，禁止用假的 composer 替换生产页面。每种样式各断言以下行为：

```tsx
it.each([false, true])('网页样式 modern=%s 只登记可见对话，原生输入时没有第二个网页编辑器', async modern => {
  localStorage.setItem('codex-mobile:web-interface', modern ? 'modern' : 'legacy');
  Object.assign(window, { __CODEX_NATIVE_UI__: false, __CODEX_NATIVE_COMPOSER__: true,
    webkit: { messageHandlers: { nativeUI: { postMessage() {} } } } });
  const runtime = new NativeRuntime(() => {});
  runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] });
  runtime.setWorkspace('b', { ...emptyNativeSnapshot(), ready: true, contextId: 'b:t' }, {});
  const view = render(<WebInterfaceProvider><ConversationPage {...conversationProps}
    nativeRuntime={runtime} nativeContextId="b:t" conversationVisible={true} /></WebInterfaceProvider>);
  expect(runtime.snapshot().webComposer).toEqual({ contextId: 'b:t', visible: true, blocked: false });
  expect(screen.queryByRole('textbox', { name: '向 Codex 提问' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '会话操作' }));
  expect(runtime.snapshot().webComposer?.blocked).toBe(true);
  view.unmount();
  expect(runtime.snapshot().webComposer).toBeUndefined();
  runtime.dispose();
});
```

`conversationProps` 使用仓库现有 `tests/ui/conversation-page*.test.tsx` 或相邻真实页面测试的最小 props；新增字段必须使用生产类型 `ComponentProps<typeof ConversationPage>`，不使用 `as any` 绕过缺失能力。补充独立用例：未挂载对话、后台设备、侧栏、历史编辑、网页 ActionSheet、模型设置、状态弹层、图片预览、卸载、recovery 后均停止原生呈现；遮罩期间不恢复 Web form。先运行 `npm test -- tests/ui/native-ui-web-composer.test.tsx` 并记录 RED。

新建 `src/native-ui/web-composer.ts`：

```ts
import { useLayoutEffect } from 'react';
import type { NativeRuntime } from './runtime';
import { isNativeBridgeEnabled, isNativeUIEnabled } from './runtime';

export function isWebNativeComposerEnabled() {
  return isNativeBridgeEnabled() && !isNativeUIEnabled();
}

export function useWebComposerPresentation(runtime: NativeRuntime | null,
  backendId: string, contextId: string, visible: boolean, blocked: boolean) {
  useLayoutEffect(() => {
    if (!runtime || !isWebNativeComposerEnabled()) return;
    runtime.setWebComposer(backendId, { contextId, visible, blocked });
  });
  useLayoutEffect(() => () => {
    runtime?.setWebComposer(backendId, undefined);
  }, [runtime, backendId, contextId]);
}

export interface NativeComposerLayout {
  contextId: string;
  top: number;
  webViewHeight: number;
}
export function nativeComposerOcclusion(layout: NativeComposerLayout, scrollBottom: number, innerHeight: number) {
  if (![layout.top, layout.webViewHeight, scrollBottom, innerHeight].every(Number.isFinite) ||
      layout.webViewHeight <= 0 || innerHeight <= 0) return 0;
  const top = layout.top * innerHeight / layout.webViewHeight;
  return Math.max(0, Math.min(innerHeight, scrollBottom - top));
}
```

`overlay-scroll.ts` 的原有层数组就是侧栏/ActionSheet 的实际登记。增加 `listeners` Set、`subscribeOverlayPresence(listener)`、`hasOverlayPresence()`，push 后和 splice 后遍历通知；`hasOverlayPresence` 返回 `layers.some(layer => layer.isConnected)`。不要另建 MutationObserver 或根据 DOM 类名推测是否存在模态。`ConversationPage` 用 `useSyncExternalStore(subscribeOverlayPresence, hasOverlayPresence, () => false)` 订阅；Legacy/ModernComposerSettings 不复用该滚动 hook，因此 App 的 `picker !== null` 通过 `webOverlayOpen` prop 显式传给页面。

在 `ConversationPage` 参数与类型声明增加 `nativeRuntime?: NativeRuntime | null`、`nativeContextId?: string`、`conversationVisible?: boolean`、`webOverlayOpen?: boolean`（默认 null/空/false/false）。在计算局部状态之后登记：

```tsx
const nativeComposer = isWebNativeComposerEnabled() && !!nativeRuntime && !!nativeContextId;
const overlayPresent = useSyncExternalStore(subscribeOverlayPresence, hasOverlayPresence, () => false);
const nativeBlocked = overlayPresent || webOverlayOpen || statusOpen || actionsOpen ||
  !!historyEdit || !!previewImage || !!queuedFollowUpEdit || attachmentMenuOpen || realtimeActive;
useWebComposerPresentation(nativeRuntime ?? null, backendId, nativeContextId ?? '',
  conversationVisible, nativeBlocked);
```

`App.tsx` 在真实 ConversationPage 调用处传入 `nativeRuntime`、`nativeContextId`、`conversationVisible` 和 `webOverlayOpen={picker !== null || !!approval}`；ConfiguredApp 的全局 manager/drafts/update 使用 ActionSheet 已有登记，不通过错误的 `active == null` 推断。无设备 bootstrap 没有 ConversationPage，因此永远没有 webComposer。原生栏因历史编辑隐藏，网页 Timeline 原位编辑仍可输入、确认、失败后保留原编辑草稿。

在 hooks 内使用 layout effect 注册与清理，切换 context 的旧清理不能删除新 context 的登记：给 `setWebComposer` 增加可选 `expectedContextId`，删除前校验当前 map 值的 context；hook cleanup 传入自身 context。先追加旧 cleanup 迟到的失败测试，再补校验。

- [x] **步骤 5：分清 Web form、网页辅助状态和面板归属；测试先证明功能没有消失。** 增加真实页面用例：旧版新对话仍可保存草稿、新版 header 草稿菜单仍可用、只读重连按钮仍在、附件处理与待引导状态仍在、新对话目标设备/项目仍可切换；不重复出现附件列表和队列。

在 ConversationPage 的 `<section>` 增加 `data-native-composer={nativeComposer || undefined}`。原 form 用 `!nativeComposer && (...)` 条件挂载，不能只是 `opacity: 0`，不能继续响应 submit 或留下辅助功能输入框。将以下内容从 form 提取为同页独立辅助块，在 nativeComposer 时显示；原 form 内保留其原路径并只渲染一次：

```tsx
{nativeComposer && <div className="native-composer-web-status">
  {accessMode === 'readOnly' && <div className="readonly-thread-banner" role="status" title={resumeError}>
    <span>{t('该会话正在其他 Codex 客户端运行，当前为只读模式')}</span>
    <button type="button" onClick={onRetry}>{t('重新连接')}</button>
  </div>}
  {imageReading && <div className="draft-image-reading" role="status">{t('正在处理附件…')}</div>}
  {pendingSteerText && <div className="pending-steer-message" role="status" aria-label={t('已发送引导')}>{pendingSteerText}</div>}
  {isNewChat && onSaveDraft && <div className="new-chat-draft-actions">
    <span role="status">{draftSaveStatus}</span>
    {!modern && <button type="button" disabled={!canSaveDraft} onClick={() => { void onSaveDraft(); }}>
      {draftSaving ? t('正在保存…') : t('保存草稿')}
    </button>}
  </div>}
</div>}
```

把该状态块放在 `.conversation-scroll-content` 底部，而非原生输入栏上方另做固定定位；它参与历史留白和滚动。RealtimeControls 沿原组件既有参数移到 form 外、只出现一次，活动时 nativeBlocked 为 true；不新增启动按钮。网页 `ImagePreviewSheet` 也移出 form，避免 portal 的生命周期被条件 form 绑住。

网页全局面板（BackendManagerSheet / DraftsSheet / AppUpdateSheet）和 `useNativeConfirmation` 的 `nativeRuntime` 参数仅在 `isNativeUIEnabled()` 为 true 时传入；混合模式继续网页原呈现，扫码仍使用已注入的共享 `codexMobileScanGatewayQr`。App 的 NativeRuntime 本身仍存在且传给会话 adapter，不能用 null 关闭业务桥。

`PanelState` 增加 `presentation?: 'full' | 'composer'`，在 `useNativeConversationAdapter` 按 `isNativeUIEnabled()` 传入。workspace snapshot 的 panel 使用：

```ts
panel: panel.presentation === 'composer' && !panel.panelId
  ? undefined
  : business.panel ?? projectPanel(c, panel),
```

这阻止网页审批自动再开原生 sheet。原生附件、mentions、队列编辑通过本来就有的 `panelId` 显式打开，仍由原生 host 呈现；历史编辑继续由网页拥有。增加用例同时打开网页审批/设置与原生动作，断言只有一个实际呈现路径，清理 context 后旧 sheet 的按钮不能调用新对话。

- [x] **步骤 6：先扩展真实 Swift smoke，再挂载混合宿主。** 在新 `tests/ci/native-ui-web-composer-smoke.swift` 中增加 `enum NativeWebComposerSmoke { @MainActor static func verify() }`，由既有 `native-ui-model-smoke.swift` main 调用，编译文件列表同步加入新 fixture。断言用真实 store：

```swift
enum NativeWebComposerSmoke {
    @MainActor static func verify() {
        let store = NativeUIStore(arguments: [])
        var value = NativeSnapshot()
        value.ready = true
        value.contextId = "b:t"
        value.backendId = "b"
        value.webComposer = NativeWebComposerPresentation(contextId: "b:t", visible: true, blocked: false)
        store.receive(value)
        precondition(store.webComposerVisible)
        value.webComposer?.blocked = true
        store.receive(value)
        precondition(!store.webComposerVisible)
        value.webComposer?.blocked = false
        value.contextId = "b:new"
        store.receive(value)
        precondition(!store.webComposerVisible, "旧页面登记不能在新对话显示")
        value.webComposer = nil
        store.receive(value)
        precondition(!store.webComposerVisible, "ready不能代替呈现登记")
        print("Native web composer smoke passed")
    }
}
```

该 smoke 应在保存默认偏好恢复的隔离上下文执行；补充完整原生优先、composer 关闭、recovery、sidebar true、pending/readOnly 只禁用编辑且不伪造新上下文等断言。先运行 `npm test -- tests/ci/ios-native-ui.test.ts -t 执行真实` 得到 RED。随后给 store 增加：

```swift
var webComposerVisible: Bool {
    guard composerEnabled, !nativeEnabled, !showLegacyForRecovery,
          snapshot.ready, !sidebarOpen,
          let presentation = snapshot.webComposer,
          presentation.contextId == snapshot.contextId else { return false }
    return presentation.visible && !presentation.blocked
}
```

`NativeUITrust.bootstrap` 增加 `composerEnabled: Bool = false` 参数；生产 attach 显式传入 `store.composerEnabled`。脚本在同一个原始 URL guard 后写 `window.__CODEX_NATIVE_COMPOSER__`。默认参数 false 保持现有信任 fixture 行为稳定；新增 fixture 显式验证 true、false 两值和其他页面不注入。

新建 `NativeWebComposerHost.swift`；它常驻于 hybrid 分支，不把 sheet 持有者包在可见输入区的 if 里面：

```swift
import SwiftUI

struct NativeWebComposerHost: View {
    @Bindable var store: NativeUIStore
    let bridge: NativeUIBridge
    var body: some View {
        VStack(spacing: 4) {
            if store.webComposerVisible && store.snapshot.panel == nil {
                if let error = store.commandError ?? store.snapshot.error {
                    Text(error).font(.caption).foregroundStyle(.red).padding(.horizontal, 12)
                }
                if let notice = store.notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
                if let mentions = store.snapshot.mentions, !mentions.isEmpty {
                    NativeMentionSuggestions(items: mentions, store: store, context: store.snapshot.contextId)
                        .padding(.horizontal, 12)
                }
                NativeComposerView(store: store, allowsMaximizing: true).id(store.contextKey)
                    .background(NativeComposerLayoutProbe(bridge: bridge, contextID: store.snapshot.contextId))
            }
        }
        .accessibilityIdentifier("native-web-composer")
        .sheet(item: panelBinding) { panel in NativePanelView(panel: panel, store: store) }
        .onChange(of: store.webComposerVisible) { _, visible in
            if !visible { bridge.clearComposerLayout(contextID: store.snapshot.contextId) }
        }
        .onDisappear { bridge.clearComposerLayout(contextID: store.snapshot.contextId) }
        .tint(NativePalette.accent)
        .environment(\.locale, Locale(identifier: store.snapshot.locale))
    }
    private var panelBinding: Binding<NativePanel?> {
        let id = store.snapshot.panel?.id
        return Binding(get: { store.snapshot.panel }, set: { value in
            if value == nil { store.closePanel(expectedID: id) }
        })
    }
}
```

最终几何探针要测量整个 VStack（包括 mentions/notice/queue/附件），不能只测文本框。将上述 probe 的 `.background` 放到该 VStack 上，传 `visible: store.webComposerVisible && store.snapshot.panel == nil`，隐藏时回传清零。原生调节 sheet 在 `NativeComposerView` 内继续使用原实现；native runtime panel 由上述稳定外层持有，不能因 `snapshot.panel != nil` 隐藏文本后销毁 sheet presenter。

`NativeUIHost` 保留现有 ZStack 与唯一 legacy；追加 `.overlay(alignment: .bottom)`，只在 `!store.nativeEnabled && store.composerEnabled && !store.showLegacyForRecovery` 时安装 `NativeWebComposerHost`。完整原生分支、legacy opacity/accessibility 和 recovery 流程保持原样。混合 host 不加 `Color.clear.frame(maxHeight: .infinity)`，避免截断网页历史点击。`native-web-composer` identifier 应只落在实际可见输入内容容器，隐藏时不得残留可交互 AX 输入框。

- [x] **步骤 7：先用真实生成脚本与几何函数测试，再实现高度回传。** 在 UI 测试中直接测试换算：WebView 高 800、原生顶部 600、网页 scroll bottom 800，留白 200；缩放到 innerHeight 400 时留白 100；scroll bottom 已缩到500时留白0；NaN/零高度拒绝；旧context事件不更新当前页面。不要把键盘高度作为第二项相加。

在 `NativeUITrust` 新增 `composerLayout(contextID: String, top: Double, webViewHeight: Double, trustedURL: URL) -> String?`，用既有 `json` 编码 payload 与原始 URL，生成的脚本核心必须是：

```js
(() => {
  const trustedURL = encodedTrustedURL;
  if (window !== window.top || location.protocol !== "file:" || new URL(location.href).href !== new URL(trustedURL).href) return;
  window.dispatchEvent(new CustomEvent("codex-mobile-native-composer-layout", { detail: encodedPayload }));
})();
```

`encodedTrustedURL` 与 `encodedPayload` 是 Swift 字符串插值中 JSONEncoder 的结果，不是执行期自由变量；fixture 应运行最终生成脚本，断言旧URL/iframe/导航改变均无事件，中文context正确往返。现有 `native-ui-trust-fixture.swift` 在 public/private fixture 输出中新增 `composerLayout`；现有 Node surface 逐个执行。

新建 `NativeComposerLayoutProbe.swift`，使用一个非交互 UIView 记录它在真实业务 WebView 内的坐标；不使用另一个 WKWebView，不假设 SwiftUI `.global` 与 window 坐标完全相同：

```swift
import SwiftUI
import UIKit

struct NativeComposerLayoutProbe: UIViewRepresentable {
    let bridge: NativeUIBridge
    let contextID: String?
    var visible = true
    func makeUIView(context: Context) -> Probe {
        let view = Probe()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        return view
    }
    func updateUIView(_ view: Probe, context: Context) {
        view.changed = { [weak bridge] probe in
            guard let contextID else { return }
            if visible { bridge?.reportComposerLayout(probe: probe, contextID: contextID) }
            else { bridge?.clearComposerLayout(contextID: contextID) }
        }
        view.setNeedsLayout()
    }
    final class Probe: UIView {
        var changed: ((UIView) -> Void)?
        override func layoutSubviews() { super.layoutSubviews(); changed?(self) }
        override func didMoveToWindow() { super.didMoveToWindow(); setNeedsLayout() }
    }
}
```

桥新增两个 public 方法（只有桥内部读 weak webView）：`reportComposerLayout` 先 guard 可信 URL、相同 window、context 匹配；用 `probe.convert(probe.bounds, to: webView).minY` 和 `webView.bounds.height` 生成上述脚本。相同 context/顶部/高度在 0.5pt 内不重复 evaluate。`clearComposerLayout` 回传 top = webView.bounds.height，令遮挡0；旧context的清理不覆盖新context。主线程 layout 中不要同步修改 observable store，只更新 bridge 的非观察几何缓存并 evaluate。

网页 `ConversationPage` 用 layout effect 安装 `codex-mobile-native-composer-layout` listener，校验 detail.contextId 与 nativeContextId 后缓存，调用 `nativeComposerOcclusion(detail, scroll.getBoundingClientRect().bottom, window.innerHeight)` 并写 scroll 的 `--native-composer-occlusion`。同时监听 window resize、visualViewport resize/scroll 重算；cleanup 移除所有 listener 与该 CSS 变量。原有 Web form ResizeObserver 只在 `!nativeComposer` 时安装，并把 `nativeComposer` 加入依赖，关闭原生/recovery 后会重新测量网页 form。

在 `styles.css` 追加以下精确作用域；modern.css 不覆盖此 bottom padding：

```css
.conversation[data-native-composer="true"] .timeline {
  padding-bottom: calc(var(--native-composer-occlusion, 0px) + 12px);
}
.native-composer-web-status { padding: 8px 16px; }
.native-composer-web-status .pending-steer-message { position: static; margin: 0 0 8px; }
```

原生栏最外层包含其底部 padding/home indicator 留白，几何值自然包括实际遮挡；不要再把 `--input-bar-bottom-offset` 加进去。键盘由 SwiftUI 现有安全区驱动，网页只使用实测位置；若 WebView 本身已缩小，换算得到只剩栏高，不能再次加键盘。`KeyboardDismissal` 注入脚本在发现当前 `.conversation[data-native-composer="true"]` 时立即 return，避免系统键盘收起驱动已经移除的 Web form；普通网页原修复不变。

- [x] **步骤 8：以失败测试保护最大化、组字、光标与失败恢复，再做最小输入栏扩展。** `NativeComposerView` 增加 `var allowsMaximizing = false` 和 `@State private var maximized = false`，默认行为不变。最大化按钮仅混合 host 启用，放现有发送按钮旁，44pt 可点击区域；既不切 Web form，也不另开编辑器。

```swift
if allowsMaximizing {
    Button {
        maximized.toggle()
        focused = true
    } label: {
        Image(systemName: maximized ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
            .frame(width: 44, height: 44)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(store.label(maximized ? "还原输入框" : "最大化输入框", maximized ? "Restore Input" : "Maximize Input"))
    .accessibilityIdentifier("native-composer-maximize")
    .disabled(!store.composerCanEdit)
}
```

给混合 host 用 GeometryReader 取得扣除键盘后的可用高度，把 `maximumEditorHeight` 传给输入栏（默认 nil）；最大化的文字区高度取 `min(320, max(80, availableHeight * 0.52))`，队列、附件、mentions 与工具按钮另算，整体不超过可用高度。采用现有 TextField 的同一实例增加 `lineLimit`/frame，未最大化仍使用原 maximumLines。不要用 if/else 创建两个 TextField；切换最大化不能重建控件或丢选区。极大字体/横屏时让附件与队列已有 ScrollView 保持上限，文字区可滚动，发送和还原始终可见。

中文组字验证必须使用真实输入控件而非只改 snapshot。优先保留现有 SwiftUI TextField；让 `updateSelection` 只在权威文本/光标实际不同于当前选区时赋值，避免本地 echo 每次返回都重设选区。不要对每次 `store.draft` 本地变动强行 `TextSelection(insertionPoint:)`。新增一个明确的外部选区应用标记（例如 `selectionRevision`），只在 `receive` 接受与本地文本/光标不同的权威快照、Skill 插入或 context 切换时增加，TextField 监听它；普通本地 binding、光标移动及相同 echo 不增加。先用真实 Swift store smoke 断言本地编辑/相同 echo 不增长、Skill 插入/新context增长；随后用中文拼音键盘验收候选不被消除。

保留现有 `draftRevision` 和 `caretOffset` 字节单位合同，不用 Swift 字符 count 代替 UTF-16。在 `tests/ui/native-ui-workspace.test.ts` 增加带 emoji、中文、尾部正文的 `mention.insert` 回归，断言只替换光标前的 mention，UTF-16 cursor 正确。新 context/旧 ACK/失败发送/附件取消回归复用现有 store/runtime 测试，增加混合 flag 参数；失败发送仍由原有 sendMessage 恢复同一草稿和附件，不由 Swift 再造恢复逻辑。

如果真实组字用例证明 SwiftUI TextSelection 仍会打断 marked text，先写能失败的 UIKit 输入 fixture，再局部引入只负责文本/选区的 UITextView representable，并显式在 `markedTextRange != nil` 时禁止外部文本/选区赋值。不得在没有失败证据时扩大到重写整套 NativeComposerView。

- [x] **步骤 9：补齐设置的用户可见入口，跑关联 GREEN。** 两套网页设置的 `nativeToggle` 旁增加独立 `composerToggle`：

```tsx
const composerToggle = nativeSwitch && (
  <section className="backend-language-settings" aria-label={t('输入框模式')}>
    <label><input type="checkbox" checked={nativeSwitch.composerEnabled}
      disabled={nativeSwitch.loading || nativeSwitch.pending}
      onChange={event => { void nativeSwitch.changeComposer(event.target.checked).catch(() => {}); }} />
      {t('使用原生输入框')}</label>
    <small>{t('下次完整启动 App 时生效')}</small>
  </section>
);
```

ModernSettingsRoot 增加 `composerToggle: ReactNode` 并在应用卡片的 nativeToggle 后渲染；旧版 BackendManagerSheet 同一位置渲染。新标签与错误提示加入 i18n 英文映射。`NativeSettingsView` 在完整原生开关下也提供该偏好，以便用户在退出完整原生前选择网页输入行为；说明仍是下次完整启动。两者独立保存，完整原生 UI 不因输入开关关闭而丢掉其现有输入栏。

执行：

```bash
npm test -- tests/ui/native-ui-runtime.test.ts tests/ui/native-ui-adapter.test.tsx tests/ui/native-ui-web-composer.test.tsx tests/ui/native-ui-workspace.test.ts tests/ui/web-interface-preference.test.tsx tests/ui/native-ui-switch-resume.test.tsx tests/ci/ios-native-ui.test.ts tests/ci/native-ui-bootstrap-contract.test.tsx
npm run typecheck
git diff --check
```

预期全部通过；新增 Swift fixture 确实被 swiftc 编译并执行。修复的是被新测试揭示的生产问题，不放宽现有上下文、请求去重、可信 URL 或检查点断言。

- [x] **步骤 10：提交一个完整可运行集成。** 先阅读 `docs/commit-conventions.md`，暂存以上实际改动，检查 `git diff --cached --check` 和 `git diff --cached --name-status`。使用中文 Conventional Commit 和包含“新增功能 / 主要修改”的正文：

```text
feat(iOS输入): 在网页对话复用原生输入框

新增功能：
- iOS 网页界面支持独立的原生输入框开关
- 原生输入框保留文字、附件、队列、模型权限和最大化编辑能力

主要修改：
- 复用同一 NativeRuntime 与业务 WebView，按显式对话状态控制呈现
- 同步实际输入栏遮挡高度并保护网页弹层、历史编辑和草稿检查点
- 增加混合模式、真实 Swift 桥及偏好回归测试
```

提交后推送当前就绪分支；不要自行推进 main、分配版本、创建 Release 或执行正式发包。

实施记录（2026-10-16）：完成任务一的源码集成、自审、范围验证与本地提交；未执行发布、推送或模拟器操作。范围测试为 24 个文件、283 项，`npm run typecheck` 与 `git diff --check` 通过。RED/GREEN 日志位于仓库外的 `~/Library/Application Support/CodexMobile/validation/native-composer-20261016/implementation-*.log`。父任务单独执行真实容器验收；后续发现的问题继续修复，不将未完成验证记为通过。

### 任务二：完成真实容器验证、文档与交付证据

**Files:** `mobile/ios/NativeUIUITests.swift`、`tests/ci/native-ui-web-composer-smoke.swift`、`tests/ci/ios-native-ui.test.ts`、`README.md`、`docs/native-ui-business-bridge.md`、`release/notes.md`；证据保存在仓库外验证目录。

- [ ] **步骤 1：先为真实混合模式写 XCTest，用明确 launch 参数进入“网页+原生输入”而非离线全原生 reference。** 可添加 `--native-web-composer-live` 作为 DEBUG override（强制 full=false、composer=true，只对该参数有效），以及 `--native-web-composer-disabled` 验证独立关闭。沿已有真实网关配置/测试会话 setup，不新建假 WebView。核心断言：

```swift
func testWebComposerUsesOneNativeInputAndPreservesWebHistory() throws {
    let app = XCUIApplication()
    app.launchArguments = ["--native-web-composer-live"]
    app.launch()
    let input = app.textFields["native-composer-input"]
    XCTAssertTrue(input.waitForExistence(timeout: 15))
    XCTAssertFalse(app.otherElements["native-ui-root"].exists)
    XCTAssertEqual(app.webViews.count, 1)
    input.tap()
    input.typeText("输入框集成验证 NATIVE_WEB_COMPOSER")
    XCTAssertTrue(app.buttons["native-send"].isEnabled)
    app.buttons["native-composer-maximize"].tap()
    XCTAssertTrue(input.exists)
    XCTAssertTrue((input.value as? String)?.contains("NATIVE_WEB_COMPOSER") == true)
    app.buttons["native-composer-maximize"].tap()
    XCTAssertEqual(app.webViews.count, 1)
}
```

若当前系统把 axis vertical TextField 暴露为 textViews，按现有 NativeUIUITests 的统一输入查询 helper 选择真实元素，不为了测试改生产可访问性角色。先在旧实现/缺失 flag 时运行新测试，保存预期 RED。

- [ ] **步骤 2：取得共享模拟器排队使用权后，执行真实集成矩阵。** 父任务负责排队、生成工程与构建，不在计划阶段执行。使用 `docs/ios-simulator-verification.md` 当前命令，`npm run ios:prepare` 只在源码关联测试 GREEN 后执行。生成工程不作为源码维护位置。至少覆盖：

| 场景 | 必须观察到的结果 |
| --- | --- |
| 两套网页样式 | 网页头部/历史保持原样；一个原生输入区；一个业务 WebView |
| 两开关四组合及完整退出重启 | 全原生优先；输入开关独立持久化；不热切换；普通 Web/Android 保留原 form |
| 无设备、侧栏、后台设备切换、初始恢复失败 | 不出现孤立原生输入；旧context命令不落入新对话 |
| 网页设置、网页图片/文件/代码/状态/审批弹层 | 原生输入收起，不遮挡、不抢焦点；关闭不自动弹键盘 |
| 网页历史编辑及失败后返回 | 原位历史编辑仍在；主原生输入隐藏；失败保留编辑草稿 |
| 原生模型/权限/速度/Skill/附件 sheet | 每次只呈现一个；关闭后依原有会话身份恢复焦点；切换会话不恢复旧焦点 |
| 照片/文件选择、取消、音视频预览、移除 | React 附件仅增加一次；取消保留草稿；旧会话选择结果被拒绝 |
| 中文拼音组字、emoji、中间插入 Skill、尾部正文 | 候选不中断；UTF-16光标正确；无文本回跳或尾部丢失 |
| 空/短/长/多行、最大化、动态字体和横屏 | 同一输入控件；发送/停止/还原始终可点；历史末条可滚到原生栏上沿以上 |
| 键盘显示、完成键收起、反复收起、附件返回 | 原生跟随系统键盘；网页底部留白只有一次补偿；无跳动或留白累积 |
| 慢发送、失败恢复、重复事件、队列编辑/重试/取消/停止 | 现有请求去重；停止不等待发送；错误与草稿属于原context；不重复RPC |
| 用户主动 recovery | 显示原网页输入，释放原生呈现与事件监听；同一业务 WebView/草稿继续使用 |

几何验收不能只看源码或 CSS 值：采集 `WKWebView.bounds`、probe 转换顶部、网页 `scroll.getBoundingClientRect()` 与最后一条消息 rect；滚到底后最后一条消息底边应在输入栏顶部之上。分别在键盘显示/隐藏、附件/队列/mentions出现、最大化与旋转时截图核对。不要把看似有 padding 的页面当作通过。

- [ ] **步骤 3：运行范围测试、必要全量及文档同步。** 范围回归已通过后才运行一次全量 `npm test` 和 `npm run typecheck`；父任务统一安排模拟器和构建/发布验证。README 描述独立输入开关默认开启与下次完整启动语义；桥接文档记录可见性、面板归属、实测布局数据流和已完成验证边界。`release/notes.md` 只写用户看得见的本版本功能，不追加构建/签名/散列模板。

- [ ] **步骤 4：清理测试会话、保存证据、提交推送。** 所有新建真实测试对话验证后及时经已有归档入口归档；关闭临时网关、释放模拟器，不关闭用户已有服务。保留每轮 RED/GREEN 命令日志、Swift fixture stdout、XCTest xcresult、截图及最终 SHA 的对应关系；不把网关口令或私有签名路径写入文档。按提交规范提交测试/文档实际变更并推送，向父任务报告最终 SHA 和证据目录。

需要发布时由父任务继续现有 releasectl 目标与批次流程；本计划不另开正式组合发包入口。提交/推送不是客户端交付完成，最终以相应成功 receipt 为准。

## 执行前与结束自查

- [ ] 两个偏好独立、默认值明确、只在完整启动冻结；保存失败没有静默降级。
- [ ] 生产业务 WKWebView 仍只有已有构造入口，原生桥只保留弱引用。
- [ ] 完整原生模式沿原路径；普通 Web/Android 不建桥、不隐藏 form。
- [ ] 对话显示由真实页面登记；遮罩/侧栏/历史编辑/卸载都能收起原生输入。
- [ ] 网页 form 和原生控件从不同时可编辑；最大化始终使用原生控件。
- [ ] 保留草稿、中文组字、UTF-16 光标、附件、Skill、失败恢复、队列和停止。
- [ ] 原生动作 sheet 的持有者稳定；网页弹层没有被 runtime 自动重复呈现。
- [ ] 布局使用实测遮挡，包含整个输入区，键盘/安全区没有双重补偿。
- [ ] 新测试先失败再实现；真实 Swift 生产代码与生成脚本均被执行；模拟器验证记录实际通过范围。
- [ ] 测试会话归档、提交推送、发布证据由负责阶段执行，未执行事项不写成完成。

本方案没有新增需要用户决定的产品或架构问题。执行中若出现现有桥无法支持的真实平台限制，先保留失败证据并报告；不得自行改为网页最大化、另一份业务状态或自动回退。
