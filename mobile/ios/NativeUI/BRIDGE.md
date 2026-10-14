# SwiftUI 与共享业务桥 v1

每个 scene 的唯一 WKWebView 仍由现有 `WebView` 构造；NativeUIHost以@State拥有该scene的独立bridge和store，通过Environment将bridge传给既有WebView，窗口之间不共享路由或草稿。旧模式与原生模式沿用原配置的 WKWebsiteDataStore。UserDefaults `codexMobile.useNativeUI` 默认 false，进程首次宿主初始化时以静态只读launchPreference固定读取；后续打开新窗口仍沿用此值；设置修改只影响下一次完整启动。原生模式 WebView 仍挂载执行业务，SwiftUI 在前方。错误视图允许当前启动临时显示旧网页。

注入、接收与派发只允许规范化后的 `Bundle.main.bundleURL/index.html`，且只允许已绑定 WebView 的主 frame；其他本地文件及远程页面均不能取得原生桥。可信 URL 由 JSONEncoder 编码进入脚本，发送时在 Swift 和 JS 实际执行处各校验一次，防止检查后导航改变。

## 双向通道

原生在 document start 注入 `window.__CODEX_NATIVE_UI__: boolean`。TS 通过 `window.codexMobilePublishNativeSnapshot(snapshot)` 发布完整快照，等价于 `window.webkit.messageHandlers.nativeUI.postMessage({type:"snapshot",snapshot})`。

Swift 通过 `window.codexMobileNativeCommand(command)` 发出 `codex-mobile-native-command` CustomEvent，`event.detail` 是 `{id:string,name:string,params:Record<string,JSON>}`。业务显式订阅，调用已有回调；禁止查询或点击 DOM。命令 id 用于关联与去重，快照由共享业务在状态变动后重新发送。原生不复制网关协议。

## 完整快照

以下是必需的 v1 JSON 字段（Swift 默认值用于静态初始化，Codable 解码时仍须完整发送）：

```json
{"version":1,"ready":true,"locale":"zh-CN","fontScale":1,"title":"Codex Mobile","connection":"connected","busy":false,"draft":"","canSend":false,"readOnly":false,"backends":[],"groups":[],"messages":[],"attachments":[],"queued":[],"approvalCount":0,"model":"模型","effort":"推理强度","models":[],"efforts":[]}
```

可选字段：`threadId, backendId, panel, error, badge`。连接状态为字符串，原生只显示，不解释协议。model/effort 为显示标签；models/efforts 的 option.value 为发回的真实业务选择值。

- backend: `{id,title,subtitle?,connected?}`。
- group: `{id,title,items:[navigationItem]}`。
- navigationItem: `{id,title,subtitle?,badge?,selected?,command?}`。
- message: `{id,role,text,status?,blocks?:panelItem[],actions?:panelItem[]}`；role=user 为泡泡，其余开放正文。text 为 Markdown，blocks 放工具、差异、文件、审批等原生通用内容。
- attachment: `{id,name,detail?,imageURL?}`；queued 使用 navigationItem。
- option: `{id,title,value:string,subtitle?}`。复杂审批 decision 可 JSON.stringify 为 value。
- panel: `{id,title,items:panelItem[]}`。
- panelItem: `{id,kind,title?,text?,value?:string,values?:string[],options?:option[],command?,children?:panelItem[],disabled?:boolean}`。
- panelItem.kind 支持 section、text、markdown、code、diff、image、link、action、toggle、textField、secureField、multilineField、singleChoice、multiChoice。image 的 value 为 URL，link 的 value 为 URL；code/diff 的 text 为原文。输入变化使用 item.command 并合并 params.value 字符串；多选变化合并 params.values 字符串数组；toggle 使用 params.value 布尔值。section 用 children。

## 固定命令

- `draft.set {value:string}`、`message.send {}`、`turn.stop {}`、`thread.new {}`。
- `model.select {value:string}`、`effort.select {value:string}`。
- `attachment.pick {kind:"photos"|"files"}`、`attachment.remove {id:string}`。
- `backend.select {id:string}`、`navigation.search {value:string}`。
- `panel.open {id:string}`，id：devices / favorites / projects / sessions / drafts / language / font / transport / notifications / updates。
- `panel.close {id:string}`。

会话列表及任意业务 action 使用快照附带的 command，原生不猜业务 id。业务必须对 ready/readOnly/权限再次校验。快照版本不为 1 被忽略；解码错误显示可恢复错误。

`--native-ui-reference` 与 `--native-ui-reference-conversation` 使用同一套 SwiftUI 组件和固定离线 store；命令只更新本地测试状态，绝不创建真实会话或请求后端。参考模式不接收 JS 快照。
