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
        precondition(NativeMarkdownBlock.parse(reference.snapshot.messages[1].text).contains { $0.kind == "code" && $0.text == "print(\"Hello\")" })
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
