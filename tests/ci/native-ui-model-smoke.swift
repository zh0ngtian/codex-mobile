import Foundation
import SwiftUI

@main
struct NativeStoreSmoke {
    @MainActor static func main() throws {
        verifyVisualContent()
        verifyDocumentPresentation()
        let defaults = UserDefaults.standard
        let previousComposerPreference = defaults.object(forKey: NativeUIPreference.composerKey)
        let previousPreference = defaults.object(forKey: NativeUIStore.preferenceKey)
        defer {
            if let previousComposerPreference { defaults.set(previousComposerPreference, forKey: NativeUIPreference.composerKey) }
            else { defaults.removeObject(forKey: NativeUIPreference.composerKey) }
            if let previousPreference { defaults.set(previousPreference, forKey: NativeUIStore.preferenceKey) }
            else { defaults.removeObject(forKey: NativeUIStore.preferenceKey) }
        }
        defaults.removeObject(forKey: NativeUIStore.preferenceKey)
        defaults.removeObject(forKey: NativeUIPreference.composerKey)
        try NativeWebComposerSmoke.verify()
        NativeComposerPresentationSmoke.verify()
        NativeHistoryEditSmoke.verify()
        let inlineJSON = Data(#"{"id":"turn:m","role":"user","text":"原消息","historyEdit":{"id":"history-edit:t:turn:m","title":"编辑历史消息","items":[{"id":"history-text","kind":"multilineField","value":"新草稿"}]}}"#.utf8)
        let inlineMessage = try JSONDecoder().decode(NativeMessage.self, from: inlineJSON)
        let inlineRoundtrip = try JSONSerialization.jsonObject(with: JSONEncoder().encode(inlineMessage)) as! [String: Any]
        precondition((inlineRoundtrip["historyEdit"] as? [String: Any])?["id"] as? String == "history-edit:t:turn:m", "真实原生DTO必须保留消息原位编辑而不丢弃字段")
        let adjustment = NativeComposerAdjustment(kind: .permission, contextID: "b:t:1", wasFocused: true)
        precondition(adjustment.restoredFocus(contextID: "b:t:1", editable: true, sidebarOpen: false) == true, "调节完成恢复原输入焦点")
        precondition(adjustment.restoredFocus(contextID: "b:t:2", editable: true, sidebarOpen: false) == nil, "过期调节面板不能聚焦另一会话")
        precondition(adjustment.restoredFocus(contextID: "b:t:1", editable: false, sidebarOpen: false) == nil, "只读或等待态不恢复键盘")
        precondition(adjustment.restoredFocus(contextID: "b:t:1", editable: true, sidebarOpen: true) == nil, "侧栏展开时不恢复键盘")
        precondition(NativeComposerAdjustment(kind: .permission, contextID: "b:t:1", wasFocused: false).restoredFocus(contextID: "b:t:1", editable: true, sidebarOpen: false) == false, "原先收起的输入保持收起")
        let attachmentSession = NativeComposerAdjustment(kind: .attachments, contextID: "b:t:1", wasFocused: true)
        let photoCommand = NativeCommand(name: "attachment.pick", params: ["kind": .string("photos")])
        precondition(attachmentSession.deferredAttachmentCommand(photoCommand, contextID: "b:t:1", editable: true, sidebarOpen: false)?.params["kind"] == .string("photos"), "关闭附件面板后执行原选择动作")
        precondition(attachmentSession.deferredAttachmentCommand(photoCommand, contextID: "b:t:2", editable: true, sidebarOpen: false) == nil, "切换会话后不能执行旧附件动作")
        precondition(attachmentSession.deferredAttachmentCommand(photoCommand, contextID: "b:t:1", editable: false, sidebarOpen: false) == nil, "只读态不能打开附件选择器")
        precondition(attachmentSession.deferredAttachmentCommand(photoCommand, contextID: "b:t:1", editable: true, sidebarOpen: true) == nil, "展开侧栏后取消待执行附件动作")
        precondition(adjustment.deferredAttachmentCommand(photoCommand, contextID: "b:t:1", editable: true, sidebarOpen: false) == nil, "配置面板不能执行附件动作")
        precondition(NativeRateLimit(remainingPercent: 72, resetsAt: 2000, windowDurationMins: 10).remainingTimePercent(at: Date(timeIntervalSince1970: 1700)) == 50)
        precondition(NativeRateLimit(remainingPercent: 72, resetsAt: nil, windowDurationMins: 10).remainingTimePercent(at: Date(timeIntervalSince1970: 1700)) == nil, "没有可靠重置时间不能伪造时间余量")
        precondition(NativeRateLimit(remainingPercent: 72, resetsAt: 2000, windowDurationMins: 0).remainingTimePercent(at: Date(timeIntervalSince1970: 1700)) == nil)
        precondition(NativeRateLimit(remainingPercent: 72, resetsAt: 2000, windowDurationMins: 10).remainingTimePercent(at: Date(timeIntervalSince1970: 2100)) == 0)
        let adjustmentStore = NativeUIStore(arguments: [])
        precondition(adjustmentStore.snapshot.fontScale == 0.875, "原生加载态固定小字号")
        var adjustmentSnapshot = NativeSnapshot()
        adjustmentSnapshot.fontScale = 1.25
        adjustmentSnapshot.ready = true
        adjustmentSnapshot.contextId = "b:t:1"
        adjustmentSnapshot.draft = "保留草稿"
        adjustmentStore.receive(adjustmentSnapshot)
        precondition(adjustmentStore.snapshot.fontScale == 0.875, "旧原生快照不能放大应用字号")
        let fontReference = NativeUIStore(arguments: ["--native-ui-reference-visual"])
        precondition(fontReference.snapshot.fontScale == 0.875, "离线参考使用实际小字号")
        fontReference.command("settings.open", ["id": .string("settings")])
        precondition(fontReference.snapshot.panel?.items.contains(where: { $0.id == "font" }) == false)
        fontReference.command("settings.font", ["value": .string("extra-large")])
        precondition(fontReference.snapshot.fontScale == 0.875, "过期字号命令不能放大离线参考")
        var adjustmentCommands: [NativeCommand] = []
        adjustmentStore.setCaretOffset(2)
        adjustmentStore.sendCommand = { adjustmentCommands.append($0) }
        let optionSelectionRevision = adjustmentStore.selectionRevision
        for name in ["model.select", "effort.select", "speed.select"] {
            adjustmentStore.chooseComposerOption(name, value: "old-option", contextID: "old-context")
        }
        precondition(adjustmentCommands.isEmpty, "旧系统菜单回调不能更改另一个上下文的模型、思考或速度")
        adjustmentStore.chooseComposerOption("model.select", value: "model", contextID: "b:t:1")
        precondition(adjustmentCommands.count == 1 && adjustmentCommands[0].params["contextId"] == .string("b:t:1"))
        precondition(adjustmentStore.draft == "保留草稿", "选择配置不得清空草稿")
        precondition(adjustmentStore.caretOffset == 2 && adjustmentStore.selectionRevision == optionSelectionRevision, "选择配置不得重置光标或组字选区")
        let normal = NativeUIStore(arguments: [])
        precondition(!normal.nativeEnabled, "首次应默认旧界面")
        defaults.set(true, forKey: NativeUIStore.preferenceKey)
        precondition(!normal.nativeEnabled, "当前启动不能热切换")
        precondition(!NativeUIStore(arguments: []).nativeEnabled, "同进程新窗口不能提前启用新偏好")
        let secondScene = NativeUIStore(arguments: [])
        normal.draft = "第一窗口"
        secondScene.draft = "第二窗口"
        var firstCommands: [String] = []
        var secondCommands: [String] = []
        normal.sendCommand = { firstCommands.append($0.name) }
        secondScene.sendCommand = { secondCommands.append($0.name) }
        normal.command("first-scene")
        secondScene.command("second-scene")
        precondition(normal.draft == "第一窗口" && secondScene.draft == "第二窗口")
        precondition(firstCommands == ["first-scene"] && secondCommands == ["second-scene"])
        let switchStore = NativeUIStore(arguments: [])
        var switchReady = NativeSnapshot()
        switchReady.ready = true
        switchStore.receive(switchReady)
        switchStore.savedNativePreference = false
        var switchCommands: [NativeCommand] = []
        switchStore.sendCommand = { switchCommands.append($0) }
        switchStore.requestNativePreference(true)
        switchStore.requestNativePreference(true)
        precondition(switchCommands.count == 1 && switchStore.preferenceSaving)
        precondition(switchCommands[0].name == "settings.native-ui" && switchCommands[0].params == ["enabled": .bool(true)], "切换只能请求共享检查点流程，不直接修改偏好")
        precondition(!switchStore.savedNativePreference && !switchStore.nativeEnabled)
        var failedSwitch = NativeSnapshot()
        failedSwitch.commandResults = [NativeCommandResult(id: switchCommands[0].id, name: "settings.native-ui", ok: false, error: "附件保存失败")]
        switchStore.receive(failedSwitch)
        precondition(!switchStore.preferenceSaving && !switchStore.savedNativePreference && switchStore.preferenceError == "附件保存失败")
        switchStore.requestNativePreference(true)
        switchStore.receivedNativePreference(true)
        precondition(switchStore.savedNativePreference && !switchStore.preferenceSaving && switchStore.preferenceError == nil && !switchStore.nativeEnabled)
        let unavailableSwitch = NativeUIStore(arguments: [])
        unavailableSwitch.savedNativePreference = false
        var unavailableCommands: [NativeCommand] = []
        unavailableSwitch.sendCommand = { unavailableCommands.append($0) }
        unavailableSwitch.requestNativePreference(true)
        precondition(unavailableCommands.isEmpty && !unavailableSwitch.preferenceSaving && unavailableSwitch.preferenceError != nil, "启动未就绪时不能派发无人监听的切换")
        var recoverySnapshot = NativeSnapshot()
        recoverySnapshot.ready = true
        recoverySnapshot.panel = NativePanel(id: "native-switch-recovery", title: "恢复草稿", items: [])
        unavailableSwitch.receive(recoverySnapshot)
        unavailableSwitch.requestNativePreference(true)
        precondition(unavailableCommands.isEmpty && !unavailableSwitch.preferenceSaving, "恢复失败页面不能让开关永久等待")
        unavailableSwitch.receive(switchReady)
        unavailableSwitch.requestNativePreference(true)
        let timeoutID = unavailableCommands.last!.id
        unavailableSwitch.expireNativePreferenceRequest("old-request")
        precondition(unavailableSwitch.preferenceSaving, "旧超时不能结束新请求")
        unavailableSwitch.expireNativePreferenceRequest(timeoutID)
        precondition(!unavailableSwitch.preferenceSaving && !unavailableSwitch.savedNativePreference && unavailableSwitch.preferenceError != nil, "没有回执时必须恢复可重试状态")
        let visual = NativeUIStore(arguments: ["--native-ui-reference-visual"])
        precondition(visual.isReference && visual.nativeEnabled && visual.snapshot.ready)
        precondition(visual.snapshot.messages.count == 2 && visual.snapshot.messages.last?.timestamp == 1791603780)
        precondition(visual.snapshot.groups.filter { $0.category == "project" }.count == 5)
        precondition(NativeUIStore(arguments: ["--native-ui-reference-visual", "--native-ui-reference-visual-sidebar"]).sidebarOpen)
        precondition(NativeUIStore(arguments: ["--native-ui-reference-visual", "--native-ui-reference-visual-focused"]).visualReferenceFocused)
        let reference = NativeUIStore(arguments: ["--native-ui-reference-conversation"])
        precondition(reference.snapshot.messages.count == 2)
        precondition(NativeMarkdownBlock.parse(reference.snapshot.messages[1].text).contains { $0.kind == .code && $0.text == "print(\"Hello\")" })
        let referenceBlocks = NativeMarkdownBlock.parse(reference.snapshot.messages[1].text)
        precondition(referenceBlocks.map(\.kind) == [.heading, .list, .list, .code, .text])
        precondition(referenceBlocks.map(\.spacingBefore) == [0, 26, 4, 12, 22])
        let plainBlocks = NativeMarkdownBlock.parse("第一段\n第二段")
        precondition(plainBlocks.count == 1 && plainBlocks[0].text == "第一段\n第二段", "连续普通行属于同一 logical paragraph，保留 Foundation 行内语义")
        precondition(NativeMarkdownBlock.parse("第一段\n\n第二段").map(\.spacingBefore) == [0, 24], "独立正文段落保留参考正文节奏")
        let rich = NativeMarkdownBlock.parse("# 一级\n\n### 三级\n\n1. 第一个\n   - [x] 子任务\n2. 第二个\n\n> 引用\n> 续行\n\n---\n\n| 列一 | 列二 |\n| :--- | ---: |\n| a\\|b | `c|d` |\n\n![示意图](https://example.com/image.png)\n\n~~~json\n{\"ok\":true}\n~~~")
        precondition(rich.filter { $0.kind == .heading }.map(\.level) == [1, 3])
        let lists = rich.filter { $0.kind == .list }
        precondition(lists.map(\.marker) == ["1.", "•", "2."])
        precondition(lists[1].depth > 0 && lists[1].checked == true)
        precondition(rich.contains { $0.kind == .quote && $0.text == "引用\n续行" })
        precondition(rich.contains { $0.kind == .rule })
        let table = rich.first { $0.kind == .table }!
        precondition(table.rows == [["列一", "列二"], ["a|b", "`c|d`"]])
        precondition(rich.contains { $0.kind == .image && $0.destination == "https://example.com/image.png" && $0.text == "示意图" })
        precondition(rich.contains { $0.kind == .code && $0.language == "json" && $0.text == "{\"ok\":true}" })
        let inlineImages = NativeMarkdownInlinePart.parse(#"前文 ![图](https://example.com/a.png) 后文 `![代码](x.png)` \![转义](y.png)"#)
        precondition(inlineImages.compactMap(\.destination) == ["https://example.com/a.png"])
        precondition(inlineImages.first?.text == "前文 ")
        precondition(inlineImages.last?.text.contains("![代码]") == true)
        let encoded = try JSONEncoder().encode(reference.snapshot)
        let decoded = try JSONDecoder().decode(NativeSnapshot.self, from: encoded)
        precondition(decoded.version == 1 && decoded.messages.count == 2)
        // 旧 v1 JSON 没有新增的 optional 展示元数据，仍必须可解码。
        precondition(decoded.projectName == nil && decoded.backendName == nil && decoded.listBackendId == nil)
        precondition(decoded.speeds == nil && decoded.permissions == nil && decoded.contextUsage == nil && decoded.sevenDayRateLimit == nil)
        precondition(decoded.messages.allSatisfy { $0.timestamp == nil })
        let oldGroup = try JSONDecoder().decode(NativeGroup.self, from: Data(#"{"id":"old","title":"旧分组","items":[]}"#.utf8))
        precondition(oldGroup.category == nil && oldGroup.newCommand == nil && oldGroup.subtitle == nil && oldGroup.loading == nil)
        var metadata = decoded
        metadata.projectName = "项目"
        metadata.backendName = "Mac"
        metadata.listBackendId = "all"
        metadata.modelValue = "model"
        metadata.effortValue = "high"
        metadata.speed = "优先"
        metadata.speedValue = "priority"
        metadata.speeds = [NativeOption(id: "priority", title: "优先", value: "priority")]
        metadata.permissionValue = "workspace-write"
        metadata.permissions = [NativeOption(id: "workspace-write", title: "工作区", value: "workspace-write")]
        metadata.contextUsage = NativeContextUsage(used: 250, total: 1000, usedPercent: 25, remainingPercent: 75)
        metadata.sevenDayRateLimit = NativeRateLimit(remainingPercent: 72, resetsAt: 1800000000, windowDurationMins: 10080)
        metadata.messages[0].timestamp = 100
        metadata.groups = [NativeGroup(id: "project", title: "项目", items: [], category: "project", subtitle: "Mac", loading: "loading", newCommand: NativeCommand(id: "new", name: "thread.new", params: ["backendId": .string("b"), "cwd": .string("")]))]
        let metadataRoundtrip = try JSONDecoder().decode(NativeSnapshot.self, from: JSONEncoder().encode(metadata))
        precondition(metadataRoundtrip.projectName == "项目" && metadataRoundtrip.backendName == "Mac" && metadataRoundtrip.listBackendId == "all")
        precondition(metadataRoundtrip.contextUsage?.remainingPercent == 75 && metadataRoundtrip.messages[0].timestamp == 100)
        precondition(metadataRoundtrip.sevenDayRateLimit?.windowDurationMins == 10080 && metadataRoundtrip.sevenDayRateLimit?.resetsAt == 1800000000)
        precondition(metadataRoundtrip.speeds?.first?.value == "priority" && metadataRoundtrip.permissions?.first?.value == "workspace-write")
        precondition(metadataRoundtrip.groups[0].newCommand?.params["cwd"] == .string(""))
        reference.command("thread.new")
        precondition(reference.snapshot.messages.isEmpty)
        reference.draft = "离线草稿"
        reference.command("message.send")
        precondition(reference.snapshot.messages.first?.text == "离线草稿")
        reference.receive(decoded)
        precondition(reference.snapshot.messages.count == 1, "参考模式不能接收真实快照")
        var invalid = decoded
        invalid.version = 2
        normal.receive(invalid)
        precondition(!normal.snapshot.ready, "不能接收其他协议版本")
        func inputSnapshot(_ context: String, _ draft: String, _ revision: Int) throws -> NativeSnapshot {
            guard var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NativeSnapshot())) as? [String: Any] else {
                throw NSError(domain: "NativeStoreSmoke", code: 1)
            }
            object["ready"] = true
            object["contextId"] = context
            object["draft"] = draft
            object["draftRevision"] = revision
            return try JSONDecoder().decode(NativeSnapshot.self, from: JSONSerialization.data(withJSONObject: object))
        }
        let inputStore = NativeUIStore(arguments: [])
        var inputCommands: [NativeCommand] = []
        inputStore.sendCommand = { inputCommands.append($0) }
        inputStore.receive(try inputSnapshot("mini:thread", "", 0))
        inputStore.draft = "第一个字"
        inputStore.updateDraft()
        inputStore.draft = "继续输入的完整草稿"
        inputStore.updateDraft()
        inputStore.receive(try inputSnapshot("mini:thread", "第一个字", 1))
        precondition(inputStore.draft == "继续输入的完整草稿", "迟到快照不能覆盖尚未确认的新输入")
        precondition(inputCommands[0].params["contextId"] == .string("mini:thread"))
        precondition(inputCommands[1].params["revision"] == .number(2))
        inputStore.receive(try inputSnapshot("mini:thread", "继续输入的完整草稿", 2))
        inputStore.receive(try inputSnapshot("mini:thread", "", 2))
        precondition(inputStore.draft.isEmpty, "发送成功后的权威清空必须生效")
        inputStore.draft = "旧会话未确认输入"
        inputStore.updateDraft()
        inputStore.receive(try inputSnapshot("studio:other", "另一个会话的输入", 0))
        precondition(inputStore.draft == "另一个会话的输入", "新上下文不能带入旧输入")
        inputStore.composerText = "a😀b"
        inputStore.setCaretOffset(3)
        precondition(inputCommands.last?.params["caretOffset"] == .number(3), "光标使用 UTF16，保留 emoji 后的正确位置")
        precondition(NativePlainText.message("## 最终\n\n答案 `ok`\n\n```swift\nprint(1)\n```", role: "assistant") == "最终\n\n答案 ok\n\nprint(1)")
        precondition(NativePlainText.message("**用户原文**", role: "user") == "**用户原文**")
        let editing = NativeUIStore(arguments: [])
        var edits: [NativeCommand] = []
        editing.sendCommand = { edits.append($0) }
        let editingScope = NativeFieldScope.panel("edit")
        var editable = NativePanelItem(id: "name", kind: "textField", value: "", command: NativeCommand(name: "field.edit"))
        var editingSnapshot = try inputSnapshot("mini:edit", "", 0)
        editingSnapshot.panel = NativePanel(id: "edit", title: "编辑", items: [editable])
        editing.receive(editingSnapshot)
        editing.setFieldValue("第一版", item: editable, scope: editingScope)
        editing.sendFieldEdit(editable, scope: editingScope, values: ["value": .string("第一版")])
        editing.setFieldValue("第二版", item: editable, scope: editingScope)
        editing.sendFieldEdit(editable, scope: editingScope, values: ["value": .string("第二版")])
        let wireKey = NativeFieldKey(scope: editingScope, itemID: editable.id).wireValue
        editable.value = "第一版"
        editingSnapshot.panel?.items = [editable]
        editingSnapshot.commandResults = [NativeCommandResult(id: edits[0].id, name: "field.edit", ok: true, contextId: "mini:edit", fieldKey: wireKey, fieldRevision: 1)]
        editing.receive(editingSnapshot)
        precondition(editing.fieldValue(editable, scope: editingScope) == "第二版", "字段旧回执不能覆盖未确认的新编辑")
        let staleEditable = editable
        editable.value = "业务规范化后的第二版"
        editingSnapshot.panel?.items = [editable]
        editingSnapshot.commandResults?.append(NativeCommandResult(id: edits[1].id, name: "field.edit", ok: true, contextId: "mini:edit", fieldKey: wireKey, fieldRevision: 2))
        editing.receive(editingSnapshot)
        precondition(editing.fieldValue(editable, scope: editingScope) == "业务规范化后的第二版")
        precondition(editing.fieldValue(staleEditable, scope: editingScope) == "业务规范化后的第二版", "旧Binding捕获的DTO不能在ACK后倒写输入")
        editing.setFieldValue("被拒绝的输入", item: editable, scope: editingScope)
        editing.sendFieldEdit(editable, scope: editingScope, values: ["value": .string("被拒绝的输入")])
        editingSnapshot.commandResults?.append(NativeCommandResult(id: edits[2].id, name: "field.edit", ok: false, contextId: "mini:edit", error: "输入未通过校验", fieldKey: wireKey, fieldRevision: 3))
        editing.receive(editingSnapshot)
        precondition(editing.fieldValue(editable, scope: editingScope) == "业务规范化后的第二版")
        precondition(editing.commandError == "输入未通过校验")
        editing.receive(editingSnapshot)
        precondition(editing.commandError == "输入未通过校验", "重复回执不重复触发错误")
        editingSnapshot.commandResults?.append(NativeCommandResult(id: "retry-success", name: "field.edit", ok: true, contextId: "mini:edit"))
        editing.receive(editingSnapshot)
        precondition(editing.commandError == nil, "同会话重试成功后必须清理失败提示")
        let rename = NativeCommand(name: "thread.manage", params: ["backendId": .string("mini"), "threadId": .string("thread-rename"), "action": .string("rename")])
        let commandCount = edits.count
        editing.perform(rename)
        precondition(editing.textPrompt != nil && edits.count == commandCount, "重命名必须先收集名称")
        editing.promptValue = "新会话名称"
        let presented = editing.textPrompt
        editing.textPrompt = nil
        editing.confirmTextPrompt(presented)
        precondition(edits.last?.params["value"] == .string("新会话名称"))
        precondition(edits.last?.params["threadId"] == .string("thread-rename"))
        let searching = NativeUIStore(arguments: [])
        var searches: [NativeCommand] = []
        searching.sendCommand = { searches.append($0) }
        var searchSnapshot = try inputSnapshot("mini:search", "", 0)
        searching.receive(searchSnapshot)
        searching.sidebarSearchText = "原"
        searching.sidebarSearchText = "原生界面"
        searchSnapshot.search = "原"
        searchSnapshot.commandResults = [NativeCommandResult(id: searches[0].id, name: "navigation.search", ok: true, contextId: "mini:search", fieldKey: "sidebar-search", fieldRevision: 1)]
        searching.receive(searchSnapshot)
        precondition(searching.search == "原生界面", "搜索旧结果不能覆盖新查询词")
        searchSnapshot.search = "原生界面"
        searchSnapshot.commandResults?.append(NativeCommandResult(id: searches[1].id, name: "navigation.search", ok: true, contextId: "mini:search", fieldKey: "sidebar-search", fieldRevision: 2))
        searching.receive(searchSnapshot)
        searchSnapshot.search = ""
        searching.receive(searchSnapshot)
        precondition(searching.search.isEmpty, "业务清空搜索应在输入确认后生效")
        let sidebarStore = NativeUIStore(arguments: [])
        var sidebarCommands: [NativeCommand] = []
        sidebarStore.sendCommand = { sidebarCommands.append($0) }
        var sidebarSnapshot = try inputSnapshot("mini:sidebar", "", 0)
        sidebarSnapshot.sidebarOpen = true
        sidebarStore.receive(sidebarSnapshot)
        precondition(sidebarStore.sidebarOpen, "业务导航打开抽屉必须同步到原生")
        sidebarStore.sidebarIsOpen = false
        sidebarStore.receive(sidebarSnapshot)
        precondition(!sidebarStore.sidebarOpen, "迟到快照不能重开用户刚关闭的抽屉")
        sidebarSnapshot.contextId = "mini:new-context"
        sidebarSnapshot.sidebarOpen = false
        sidebarSnapshot.commandResults = [NativeCommandResult(id: sidebarCommands[0].id, name: "navigation.sidebar", ok: true, contextId: { if case .string(let value) = sidebarCommands[0].params["contextId"] { return value }; return nil }(), fieldKey: "sidebar-state", fieldRevision: 1)]
        sidebarStore.receive(sidebarSnapshot)
        sidebarSnapshot.sidebarOpen = true
        sidebarStore.receive(sidebarSnapshot)
        precondition(sidebarStore.sidebarOpen, "回执确认后业务导航仍可再次打开抽屉")
        precondition(NativeImageData.data(for: "data:image/png;base64,aGVsbG8=") == Data("hello".utf8))
        precondition(NativeImageData.data(for: "data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E") == Data("<svg></svg>".utf8))
        precondition(NativeImageData.data(for: "data:text/html;base64,aGVsbG8=") == nil)
        precondition(NativeImageData.data(for: "data:image/png;base64,%%invalid%%") == nil)
        precondition(NativeImageData.remoteURL("file:///private/secret.png") == nil)
        precondition(NativeImageData.remoteURL("https://example.com/a.png") != nil)
        precondition(NativeImageData.needsWebRenderer("data:image/svg+xml,%3Csvg/%3E", title: ""))
        precondition(NativeImageData.needsWebRenderer("https://example.com/preview?path=%2Ftmp%2Fa.gif", title: ""))
        precondition(!NativeImageData.needsWebRenderer("https://example.com/a.jpg", title: ""))
        precondition(NativeImageData.webImageHTML("file:///private/a.svg", title: "x") == nil)
        precondition(NativeImageData.webImageHTML("https://example.com/a.svg?x=1&y=2", title: "<script>")?.contains("&lt;script&gt;") == true)
        precondition(NativeMediaSource.data("data:audio/wav;base64,aGVsbG8=")?.bytes == Data("hello".utf8))
        precondition(NativeMediaSource.data("data:text/html;base64,aGVsbG8=") == nil)
        precondition(NativeMediaSource.data("file:///private/media.mp4") == nil)
        let reading = NativeTimelineState()
        reading.receive(messageIDs: ["recent-a", "recent-b"])
        reading.visibleMessageID = "recent-a"
        reading.followsTail = false
        reading.receive(messageIDs: ["older", "recent-a", "recent-b"])
        precondition(reading.pendingAnchorID == "recent-a", "加载旧回合应保留原可见消息锚点")
        reading.didRestoreAnchor()
        precondition(reading.pendingAnchorID == nil && !reading.followsTail)
        let otherReading = inputStore.timeline(for: "other-thread")
        let sameReading = inputStore.timeline(for: "first-thread")
        sameReading.visibleMessageID = "read-before"
        sameReading.followsTail = false
        precondition(inputStore.timeline(for: "first-thread") === sameReading)
        precondition(otherReading.followsTail && otherReading.visibleMessageID == nil, "不同会话阅读位置独立")
        let scopeA = NativeFieldScope.panel("settings")
        let scopeB = NativeFieldScope.panel("other-settings")
        let textField = NativePanelItem(id: "shared-field", kind: "textField", value: "业务校正值")
        let secureField = NativePanelItem(id: "password", kind: "secureField", value: "")
        let multiChoice = NativePanelItem(id: "choice", kind: "multiChoice", values: ["authoritative"])
        normal.setFieldValue("旧输入", item: textField, scope: scopeA)
        normal.setSelectedValues(["old"], item: multiChoice, scope: scopeA)
        var authoritative = NativeSnapshot()
        authoritative.panel = NativePanel(id: "settings", title: "设置", items: [textField, secureField, multiChoice])
        normal.receive(authoritative)
        precondition(normal.fieldValue(textField, scope: scopeA) == "业务校正值", "权威快照必须清理旧字段覆盖值")
        precondition(normal.selectedValues(multiChoice, scope: scopeA) == ["authoritative"])
        normal.setFieldValue("临时秘密", item: secureField, scope: scopeA)
        normal.setFieldValue("本地输入", item: textField, scope: scopeA)
        normal.setSelectedValues(["pending"], item: multiChoice, scope: scopeA)
        precondition(normal.fieldValue(textField, scope: scopeB) == "业务校正值", "不同面板的相同字段id必须隔离")
        normal.closePanel()
        precondition(normal.snapshot.panel == nil)
        precondition(normal.fieldValue(secureField, scope: scopeA).isEmpty, "关闭面板必须清除秘密缓存")
        precondition(normal.selectedValues(multiChoice, scope: scopeA) == ["authoritative"])
        normal.receive(authoritative)
        precondition(normal.fieldValue(textField, scope: scopeA) == "业务校正值", "重新打开同id面板不能恢复旧输入")
        normal.setFieldValue("再次编辑", item: textField, scope: scopeA)
        authoritative.panel = NativePanel(id: "other-settings", title: "另一面板", items: [textField])
        normal.receive(authoritative)
        precondition(normal.fieldValue(textField, scope: scopeA) == "业务校正值", "更换面板必须清理旧作用域")
        let params: [String: NativeJSONValue] = ["text": .string("中文\n内容"), "nested": .object(["ok": .bool(true)]), "items": .array([.null, .number(2)])]
        let command = NativeCommand(name: "test", params: params)
        let commandRoundtrip = try JSONDecoder().decode(NativeCommand.self, from: JSONEncoder().encode(command))
        precondition(commandRoundtrip.params == params)
        print("Native store/schema/Markdown smoke passed")
    }

    private static func verifyVisualContent() {
        var checks = 0
        func expect(_ condition: @autoclosure () -> Bool, _ reason: String) {
            checks += 1
            precondition(condition(), reason)
        }
        func plain(_ source: String) -> String { String(NativeInlineMarkdown.text(source).characters) }
        func strong(_ source: String) -> String {
            let text = NativeInlineMarkdown.text(source)
            return text.runs.filter { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true }
                .map { String(text[$0.range].characters) }.joined()
        }
        func links(_ source: String) -> [URL] { NativeInlineMarkdown.text(source).runs.compactMap(\.link) }
        let linkedPresentation = NativeInlineMarkdown.text("正文 [网页](https://example.com/path) 和 [文件](/tmp/example.swift#L12)")
        let linkedRuns = linkedPresentation.runs.filter { $0.link != nil }
        expect(linkedRuns.count == 2, "网页与文件仍是真实可点击链接")
        expect(linkedRuns.allSatisfy { $0.underlineStyle == Text.LineStyle(pattern: .dash) }, "网页与文件链接均须使用虚线下划线")
        expect(linkedPresentation.runs.filter { $0.link == nil }.allSatisfy { $0.underlineStyle == nil }, "虚线不能扩散到普通正文")
        expect(linkedRuns.compactMap(\.link).map(\.absoluteString) == ["https://example.com/path", "/tmp/example.swift#L12"], "样式修正不能改写链接目的地")
        let cjk = "**二是希望细化合规路径及办理指导。**企业关注"
        expect(plain(cjk) == "二是希望细化合规路径及办理指导。企业关注", "中文句末粗体不能裸露星号")
        expect(strong(cjk) == "二是希望细化合规路径及办理指导。", "仅前句应有真实 Foundation strong 属性")
        expect(plain("前文**中文，**后文 **结束！**企业") == "前文中文，后文 结束！企业", "多个中文标点粗体可相邻正文")
        expect(strong("前文**中文，**后文 **结束！**企业") == "中文，结束！", "多个粗体范围不能扩散到后文")
        expect(strong("***粗体斜体。***企业") == "粗体斜体。", "保留粗斜体组合")
        let combination = NativeInlineMarkdown.text("***粗体斜体。***企业")
        expect(combination.runs.first?.inlinePresentationIntent?.contains(.emphasized) == true, "保留真实强调属性")
        expect(plain("**normal** and *italic* and __strong__ snake_case") == "normal and italic and strong snake_case", "正常 Markdown 和下划线语义不回归")
        expect(strong("**normal** and *italic* and __strong__ snake_case") == "normalstrong", "原有粗体范围不回归")
        expect(plain("`**代码。**企业` ``代码 ` **标点。**企业``") == "**代码。**企业 代码 ` **标点。**企业", "任意长度行内代码不处理星号")
        expect(plain(#"\**转义。**企业"#) == "**转义。**企业", "转义的开标记不能生成粗体")
        expect(strong(#"\**转义。**企业"#).isEmpty, "转义内容不能有 strong 属性")
        expect(plain("**未闭合。企业") == "**未闭合。企业", "未闭合星号必须保留")
        expect(plain("__未闭合。企业") == "__未闭合。企业", "未闭合下划线必须保留")
        let web = "[网页](https://example.com/a**x。**企业)"
        expect(links(web).first?.absoluteString == "https://example.com/a**x%E3%80%82**%E4%BC%81%E4%B8%9A", "链接 URL 不改写")
        let path = "/Users/example/中文 文件(1)%20#附件[2]*.xlsx"
        let citation = ":codex-file-citation{path=\"\(path)\" purpose=\"source\" artifact_kind=\"workbook\"}"
        let reference = NativeInlineMarkdown.text("来源 \(citation)。")
        expect(String(reference.characters) == "来源 中文 文件(1)%20#附件[2]*.xlsx。", "引用应显示逐字 basename")
        expect(reference.runs.compactMap(\.link).count == 1, "引用必须生成真实可点击 link 属性")
        let href = reference.runs.compactMap(\.link).first?.absoluteString
        expect(href?.removingPercentEncoding == path, "空格中文括号百分号井号必须经 URL 逐字往返")
        expect(href?.contains("%20") == true && href?.contains("%23") == true && href?.contains("%25") == true && href?.contains("%28") == true, "文件路径使用逐段 URL 编码")
        expect(plain("前文:codex-file-citation{path='/tmp/first.doc'}::codex-file-citation{extra='值' path='/tmp/second.doc'}") == "前文first.docsecond.doc", "单双冒号及相邻引用兼容")
        expect(links("**\(citation)**").count == 1 && strong("**\(citation)**") == "中文 文件(1)%20#附件[2]*.xlsx", "引用保留周围强强调")
        let invalid = [
            ":codex-file-citation{purpose='source'}",
            ":codex-file-citation{path='/tmp/a.doc' path='/tmp/b.doc'}",
            ":codex-file-citation{path='relative.doc'}",
            ":codex-file-citation{path='file:///tmp/a.doc'}",
            ":codex-file-citation{path='https://example.com/a.doc'}",
            ":codex-file-citation{path='/unsupported/a.doc'}",
            ":codex-file-citation{path='/tmp/'}",
            ":codex-file-citation{path='/tmp//a.doc'}",
            ":codex-file-citation{path='/tmp/./a.doc'}",
            ":codex-file-citation{path='/tmp/../a.doc'}",
            ":codex-file-citation{path='/tmp/a.doc:12'}",
            ":codex-file-citation{path='/tmp/a.doc:12:3'}",
            ":codex-file-citation{path='/tmp/a\u{0001}b.doc'}",
            ":codex-file-citation{path='/tmp/a\u{007f}b.doc'}",
            ":codex-file-citation{path='/tmp/a\u{0085}b.doc'}",
            ":codex-file-citation{path='/tmp/a\u{2028}b.doc'}",
            ":codex-file-citation{path=/tmp/a.doc}",
            ":codex-file-citation{path='/tmp/a.doc' broken}",
            ":codex-file-citation{path='/tmp/a.doc'extra='x'}",
            ":codex-file-citation{path='/tmp/a.doc'",
            ":codex-file-citation{path='/tmp/a.doc}",
            ":::codex-file-citation{path='/tmp/a.doc'}",
            "::::codex-file-citation{path='/tmp/a.doc'}",
            ":codex-file-citation{broken :codex-file-citation{path='/tmp/nested.doc'}}",
            ":codex-file-citation{path='/tmp/unclosed :codex-file-citation{path='/tmp/nested.doc'}}"
        ]
        for value in invalid {
            expect(plain(value) == value && links(value).isEmpty, "非法或不完整引用必须原样保留：\(value)")
        }
        expect(plain("`\(citation)`") == citation && links("`\(citation)`").isEmpty, "行内代码不能生成文件链接")
        expect(plain("``\(citation)``") == citation && links("``\(citation)``").isEmpty, "多反引号代码不能生成文件链接")
        let linked = "[\(citation)](https://example.com)"
        expect(plain(linked) == citation && links(linked).map(\.absoluteString) == ["https://example.com"], "已有链接标签不生成嵌套文件链接")
        for html in ["<code>\(citation)</code>", "<span title='>'>\(citation)</span>", "<span><!-- </span> -->\(citation)</span>", "<div>\n\(citation)\n</div>", "<!-- \(citation) -->"] {
            expect(!links(html).contains { $0.absoluteString.removingPercentEncoding == path }, "HTML 示例不能生成文件链接")
        }
        expect(links("<span>\(citation)</span> \(citation)").count == 1, "HTML 闭合后恢复外部引用")
        expect(plain(#"\:codex-file-citation{path='/tmp/a.doc'}"#) == ":codex-file-citation{path='/tmp/a.doc'}" && links(#"\:codex-file-citation{path='/tmp/a.doc'}"#).isEmpty, "转义指令不生成链接")
        expect(strong("**粗体*斜体*。**企业") == "粗体斜体。", "内部强调不破坏中文粗体边界")
        expect(links("[\(citation)][file]").isEmpty, "已有引用链接标签不生成文件链接")
        let fenced = "```text\n\(citation)\n**原样。**企业\n```"
        expect(NativePlainText.message(fenced, role: "assistant") == "\(citation)\n**原样。**企业", "代码块可访问文本保留原代码")
        expect(NativePlainText.message(cjk + "\n\n来源 " + citation, role: "assistant") == "二是希望细化合规路径及办理指导。企业关注\n\n来源 中文 文件(1)%20#附件[2]*.xlsx", "可访问文本必须与正文使用同一展示解释")
        expect(NativePlainText.message(cjk + citation, role: "user") == cjk + citation, "用户原文复制行为保持不变")
        print("Native visual content \(checks) assertions passed")
    }


    private static func verifyDocumentPresentation() {
        var checks = 0
        func expect(_ condition: @autoclosure () -> Bool, _ reason: String) {
            checks += 1
            precondition(condition(), reason)
        }
        // 与生产 BlockView → InlineContentView → InlinePart 相同的分块和图片分段管线。
        func rendered(_ source: String) -> [AttributedString] {
            NativeMarkdownBlock.parse(source).flatMap { block -> [AttributedString] in
                if block.kind == .code || block.kind == .image || block.kind == .rule { return [] }
                if block.kind == .heading { return [NativeInlineMarkdown.text(block.text, scope: block.scope)] }
                if block.kind == .table {
                    return block.rows.enumerated().flatMap { rowIndex, row in
                        row.enumerated().flatMap { columnIndex, text in
                            NativeMarkdownInlinePart.parse(text, scope: block.cellScopes[rowIndex][columnIndex])
                                .filter { $0.destination == nil }.map { NativeInlineMarkdown.text($0.text, scope: $0.scope) }
                        }
                    }
                }
                return NativeMarkdownInlinePart.parse(block.text, scope: block.scope).filter { $0.destination == nil }
                    .map { NativeInlineMarkdown.text($0.text, scope: $0.scope) }
            }
        }
        func fileLinks(_ source: String) -> [URL] {
            rendered(source).flatMap { $0.runs.compactMap(\.link) }.filter { $0.absoluteString.hasPrefix("/") }
        }
        let inside = ":codex-file-citation{path='/tmp/inside.doc'}"
        let outside = ":codex-file-citation{path='/tmp/outside.doc'}"
        let qualityCases = [
            ("跨行已有链接标签", fileLinks("[网页\n\(inside)](https://example.com)").isEmpty),
            ("跨行引用链接标签", fileLinks("[网页\n\(inside)][ref]").isEmpty),
            ("list 真实边界", NativeMarkdownBlock.parse("- `first\n- second`").map(\.kind) == [.list, .list]),
            ("heading 真实边界", NativeMarkdownBlock.parse("plain `first\n# heading`").map(\.kind) == [.text, .heading]),
            ("heading 后正文边界", NativeMarkdownBlock.parse("# `heading\nparagraph`").map(\.kind) == [.heading, .text]),
            ("setext 真实边界", NativeMarkdownBlock.parse("one `first\n---\nsecond`").map(\.kind) == [.heading, .text]),
            ("跨行链接内整行 image", fileLinks("[网页\n![图](https://example.com/a.png)\n\(inside)](https://example.com)").isEmpty)
        ]
        let qualityFailures = qualityCases.filter { !$0.1 }.map { $0.0 }
        checks += qualityCases.count
        if !qualityFailures.isEmpty {
            FileHandle.standardError.write(Data(("Quality regressions: " + qualityFailures.joined(separator: "、") + "\n").utf8))
        }
        precondition(qualityFailures.isEmpty, "logical paragraph 必须保留真实块边界与完整行内范围")
        let imageInCode = "<span>\n`first\n![</span>](https://example.com/a.png)\nlast`\n\(inside)\n</span>"
        expect(rendered(imageInCode).contains { value in value.runs.contains { run in run.inlinePresentationIntent?.contains(.code) == true && String(value[run.range].characters).contains("![</span>]") } }, "普通段落内整行 image 不切断行内 code 范围")
        let nestedImage = "<span> ![a [b](https://example.com/b.png) </span>](https://example.com/a.png) \(inside)"
        let multilineCode = "<span>\n`多行\n</span>\n代码`\n\(inside)\n</span>"
        let rangeFailures = [
            ("image 完整范围", fileLinks(nestedImage).isEmpty),
            ("跨行 inline code 范围", fileLinks(multilineCode).isEmpty)
        ].filter { !$0.1 }.map { $0.0 }
        if !rangeFailures.isEmpty {
            FileHandle.standardError.write(Data(("Range regressions: " + rangeFailures.joined(separator: "、") + "\n").utf8))
        }
        checks += 2
        precondition(rangeFailures.isEmpty, "完整 token 范围必须贯穿实际消费者管线")
        let fenceCases = [
            ("不等长 backtick fence", "```html\n<span>\n````\n<span>\n`跨行\n</span>\n代码`\n\(inside)\n</span>"),
            ("tilde fence 内未闭合注释", "~~~html\n<!--\n~~~\n<span>\n`多行\n</span>\n代码`\n\(inside)\n</span>"),
            ("空段前未配对反引号", "未配对 `\n\n<span>\n`跨行\n</span>\n代码`\n\(inside)\n</span>")
        ]
        let fenceFailures = fenceCases.filter { !fileLinks($0.1).isEmpty }.map { $0.0 }
        checks += fenceCases.count
        if !fenceFailures.isEmpty {
            FileHandle.standardError.write(Data(("Fence regressions: " + fenceFailures.joined(separator: "、") + "\n").utf8))
        }
        precondition(fenceFailures.isEmpty, "fenced 内容必须在发现文档 inline 范围之前隔离")
        for (reason, value) in fenceCases {
            let unicodeDocument = "前置😀e\u{301}中文\n\n" + value + "\n" + outside
            expect(fileLinks(unicodeDocument).map(\.absoluteString) == ["/tmp/outside.doc"], reason + "前有 Unicode 时仍按原文索引保护")
        }
        expect(NativePlainText.message("😀e\u{301}中文 `a\n</span>\nb` 后文", role: "assistant") == "😀e\u{301}中文 a </span> b 后文", "文档 code token 的 Unicode 范围与正文恢复逐字一致")
        expect(fileLinks("`未闭合\n\n" + outside).count == 1 && fileLinks(outside).count == 1, "文档预处理的未闭合状态不泄漏到其他段落或文档")
        let imageParts = NativeMarkdownInlinePart.parse(nestedImage)
        expect(imageParts.compactMap(\.destination).isEmpty, "复杂图片范围不一致时不抽取局部图片")
        expect(imageParts.count == 1 && imageParts.first?.text == nestedImage, "复杂图片整体交给既有 Foundation 解释")
        expect(fileLinks("`未闭合\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "未配对反引号不能把后续整篇当代码")
        expect(fileLinks("<span>\n`未闭合\n</span>\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "未配对反引号不能屏蔽真实闭合标签")
        let codeRuns = rendered(multilineCode).flatMap { value in
            value.runs.filter { $0.inlinePresentationIntent?.contains(.code) == true }.map { String(value[$0.range].characters) }
        }
        expect(codeRuns == ["多行 </span> 代码"], "跨行代码恢复真实 Foundation code 属性与内容")
        expect(NativePlainText.message(multilineCode, role: "assistant").contains("多行 </span> 代码"), "可访问文本恢复代码正文且不泄漏临时 token")
        expect(fileLinks("<span>\n``多行\n</span>\n`代码``\n\(inside)\n</span>").isEmpty, "多反引号跨行代码中的单反引号不会提前结束范围")
        expect(fileLinks("<span>\n`多行\n</span>\n代码`\n</span> \(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "跨行代码结束后真实 HTML 闭合仍恢复文件引用")
        let fencedBackticks = "```text\n`跨行\n</span>`\n```"
        expect(NativePlainText.message(fencedBackticks, role: "assistant") == "`跨行\n</span>`", "fenced 代码中的反引号与换行不能被文档预处理改写")
        expect(NativePlainText.message("前文\r\n" + fencedBackticks.replacingOccurrences(of: "\n", with: "\r\n"), role: "assistant") == "前文\n\n`跨行\n</span>`", "原有 CRLF 归一必须先于文档保护，fenced 代码内容不变")
        expect(fileLinks("`未闭合\n\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "未配对反引号跨段落后仍允许普通引用")
        expect(fileLinks("`第一段\n\n\(outside)\n\n最后`").map(\.absoluteString) == ["/tmp/outside.doc"], "空段边界两侧反引号不能合并成跨段代码")
        let strongCode = rendered("**正文 `代码\n第二行` 后文**")
        let strongCodeRuns = strongCode.flatMap { $0.runs.filter { $0.inlinePresentationIntent?.contains(.code) == true } }
        expect(!strongCodeRuns.isEmpty && strongCodeRuns.allSatisfy { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true }, "恢复跨行 code 保留外层 strong 属性")
        let protectedImages = [
            ("HTML 属性内图片", "<span title=\"![图](https://example.com/a.png)\"> \(inside)</span>"),
            ("已有链接标签内图片", "[网页 ![图](https://example.com/a.png) \(inside)](https://example.com)"),
            ("非法整体引用内图片", ":codex-file-citation{broken ![图](https://example.com/a.png) :codex-file-citation{path='/tmp/nested.doc'}}")
        ]
        let reviewCases = protectedImages + [
            ("跨 block 未完成 HTML 标签", "<span\ntitle='x'> \(inside)\n</span>"),
            ("表格单反斜杠转义引用", "| " + "\\" + inside + " | x |\n| --- | --- |")
        ]
        var reviewFailures: [String] = []
        for (reason, value) in reviewCases {
            checks += 1
            if !fileLinks(value).isEmpty { reviewFailures.append(reason) }
        }
        if !reviewFailures.isEmpty {
            FileHandle.standardError.write(Data(("Review regressions: " + reviewFailures.joined(separator: "、") + "\n").utf8))
        }
        precondition(reviewFailures.isEmpty, "规格审查的实际消费者管线回归必须通过")
        for (reason, value) in protectedImages {
            expect(NativeMarkdownInlinePart.parse(value).compactMap(\.destination).isEmpty, reason + "不能切断原保护结构")
        }
        expect(fileLinks("<div>\n\(inside)\n</div>").isEmpty, "实际分块后的多行 HTML 不能生成文件操作")
        let boundaries = "<div>\n\n# 标题 \(inside)\n\n- 列表 \(inside)\n\n> 引用 \(inside)\n\n</div> 后文 \(outside)"
        expect(fileLinks(boundaries).map(\.absoluteString) == ["/tmp/outside.doc"], "空行、标题、列表和引用分块必须继承文档 HTML 范围")
        expect(fileLinks("<span>\n\(inside)\n</span> \(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "闭合标签同行之后恢复正常文件引用")
        expect(fileLinks("```html\n<div>\n```\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "fenced 代码的伪 HTML 标签不能污染后续正文")
        expect(fileLinks("<span>\n```html\n</span>\n```\n\(inside)\n</span>\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "代码中的伪闭合标签不能结束外部 HTML 范围")
        expect(fileLinks("`<div>`\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "行内代码的伪标签不污染后续 block")
        expect(fileLinks("<span> 开头 ![图](https://example.com/a.png) \(inside)</span> \(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "图片切开正文后必须继承同一 HTML 范围")
        expect(fileLinks("![<div>](https://example.com/a.png)\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "图片替代文本的伪标签不能污染外部正文")
        expect(fileLinks("<span>\n<!-- </span> -->\n\(inside)\n</span>\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "跨 block HTML 注释的伪标签不改变真实范围")
        expect(fileLinks("[<span>网页](https://example.com)\n\(inside)\n</span>\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "已有链接标签中的 HTML 起始标签仍推进文档范围")
        expect(fileLinks("<span>\n[网页 </span>](https://example.com)\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "已有链接标签中的闭合标签恢复后续引用")
        expect(fileLinks("<span>\n<!--\n</span>\n-->\n\(inside)\n</span>\n\(outside)").map(\.absoluteString) == ["/tmp/outside.doc"], "跨 block 注释内的伪闭合标签不能改变范围")
        let table = "| <span>标题 | \(inside) |\n| --- | --- |\n| \(inside) | </span> \(outside) |\n\(outside)"
        expect(fileLinks(table).map(\.absoluteString) == ["/tmp/outside.doc", "/tmp/outside.doc"], "表格单元格与后续正文共享文档范围")
        expect(fileLinks("<span>\n\(inside)").isEmpty && fileLinks(outside).count == 1, "独立文档之间不泄漏 HTML scope")
        let accessibility = NativePlainText.message(boundaries, role: "assistant")
        expect(accessibility.contains(inside) && accessibility.contains("outside.doc") && !accessibility.contains(outside), "可访问文本共享文档 HTML 解释，保留示例正文")
        print("Native document presentation \(checks) assertions passed")
    }

}
