import Foundation

@main
struct NativeStoreSmoke {
    @MainActor static func main() throws {
        let defaults = UserDefaults.standard
        let previousPreference = defaults.object(forKey: NativeUIStore.preferenceKey)
        defer {
            if let previousPreference { defaults.set(previousPreference, forKey: NativeUIStore.preferenceKey) }
            else { defaults.removeObject(forKey: NativeUIStore.preferenceKey) }
        }
        defaults.removeObject(forKey: NativeUIStore.preferenceKey)
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
        let reference = NativeUIStore(arguments: ["--native-ui-reference-conversation"])
        precondition(reference.snapshot.messages.count == 2)
        precondition(NativeMarkdownBlock.parse(reference.snapshot.messages[1].text).contains { $0.kind == .code && $0.text == "print(\"Hello\")" })
        let referenceBlocks = NativeMarkdownBlock.parse(reference.snapshot.messages[1].text)
        precondition(referenceBlocks.map(\.kind) == [.heading, .list, .list, .code, .text])
        precondition(referenceBlocks.map(\.spacingBefore) == [0, 26, 20, 12, 22])
        let plainBlocks = NativeMarkdownBlock.parse("第一段\n第二段")
        precondition(plainBlocks.map(\.spacingBefore) == [0, 12], "未特判的正文保留默认节奏")
        let encoded = try JSONEncoder().encode(reference.snapshot)
        let decoded = try JSONDecoder().decode(NativeSnapshot.self, from: encoded)
        precondition(decoded.version == 1 && decoded.messages.count == 2)
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
        editable.value = "业务规范化后的第二版"
        editingSnapshot.panel?.items = [editable]
        editingSnapshot.commandResults?.append(NativeCommandResult(id: edits[1].id, name: "field.edit", ok: true, contextId: "mini:edit", fieldKey: wireKey, fieldRevision: 2))
        editing.receive(editingSnapshot)
        precondition(editing.fieldValue(editable, scope: editingScope) == "业务规范化后的第二版")
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
}
