import Foundation

/// 使用生产 store 验证编辑字段不随删除确认 sheet 的生命周期丢失，也不跨目标复用。
enum NativeHistoryEditSmoke {
    @MainActor static func verify() {
        var checks = 0
        func check(_ value: @autoclosure () -> Bool, _ reason: String) { checks += 1; precondition(value(), reason) }
        let store = NativeUIStore(arguments: [])
        var commands: [NativeCommand] = []
        store.sendCommand = { commands.append($0) }
        let field = NativePanelItem(id: "history-text", kind: "multilineField", value: "原消息", command: NativeCommand(name: "history.change", params: ["contextId": .string("context-a"), "editKey": .string("t:turn:m")]))
        let editor = NativePanel(id: "history-edit:t:turn:m", title: "编辑历史消息", items: [field])
        var value = NativeSnapshot()
        value.ready = true; value.contextId = "context-a"; value.threadId = "t"; value.draft = "普通草稿"
        value.messages = [NativeMessage(id: "turn:m", role: "user", text: "原消息", historyEdit: editor)]
        store.receive(value)
        let scope = NativeFieldScope.historyEdit(contextID: "context-a", messageID: "turn:m", editID: editor.id)
        check(store.fieldValue(field, scope: scope) == "原消息", "首次输入读取原历史业务状态")
        store.setFieldValue("未回执草稿", item: field, scope: scope)
        store.sendFieldEdit(field, scope: scope, values: ["value": .string("未回执草稿")])
        let editCommand = commands.last!
        check(editCommand.params["contextId"] == .string("context-a"), "编辑命令保留创建上下文")
        value.panel = NativePanel(id: "confirm-history:t:turn:m", title: "确认", items: [])
        store.receive(value)
        check(store.fieldValue(field, scope: scope) == "未回执草稿", "打开删除确认不能清掉未回执原位输入")
        store.closePanel(expectedID: value.panel!.id)
        check(store.fieldValue(field, scope: scope) == "未回执草稿", "关闭删除确认不能清掉原位字段scope")
        value.panel = nil
        value.messages[0].historyEdit!.items[0].value = "权威已接受草稿"
        let key = NativeFieldKey(scope: scope, itemID: field.id).wireValue
        let revision: Int
        if case .number(let number) = editCommand.params["fieldRevision"] { revision = Int(number) } else { preconditionFailure("必须有字段版本") }
        value.commandResults = [NativeCommandResult(id: editCommand.id, name: "history.change", ok: true, contextId: "context-a", fieldKey: key, fieldRevision: revision)]
        store.receive(value)
        check(store.fieldValue(field, scope: scope) == "权威已接受草稿", "ACK后旧View绑定仍从当前消息编辑DTO读取")
        value.commandResults = [NativeCommandResult(id: "failed-send", name: "history.submit", ok: false, contextId: "context-a", error: "发送失败")]
        store.receive(value)
        check(store.fieldValue(field, scope: scope) == "权威已接受草稿" && store.commandError == "发送失败", "发送失败保留原位草稿与错误")
        check(store.draft == "普通草稿", "历史编辑不改普通composer草稿")
        value.messages[0].historyEdit!.items[0].disabled = true
        store.receive(value)
        let lockedCount = commands.count
        store.sendFieldEdit(field, scope: scope, values: ["value": .string("提交中输入")])
        check(commands.count == lockedCount, "提交中旧字段binding不能继续发送输入")
        value.messages[0].historyEdit!.items[0].disabled = false
        store.receive(value)
        store.setFieldValue("取消前未回执", item: field, scope: scope)
        store.sendFieldEdit(field, scope: scope, values: ["value": .string("取消前未回执")])
        value.messages[0].historyEdit = nil; value.commandResults = nil
        store.receive(value)
        value.messages[0].historyEdit = editor
        store.receive(value)
        check(store.fieldValue(field, scope: scope) == "原消息", "取消后同目标重开不复用前次未回执草稿")
        value.contextId = "context-b"
        store.receive(value)
        let switchedCount = commands.count
        store.sendFieldEdit(field, scope: scope, values: ["value": .string("过期输入")])
        check(commands.count == switchedCount, "切换context后旧binding不得发送到另一会话")
        check(NativeFieldKey(scope: scope, itemID: field.id).wireValue != NativeFieldKey(scope: .historyEdit(contextID: "context-b", messageID: "turn:m", editID: editor.id), itemID: field.id).wireValue, "相同目标id在不同context有独立字段key")
        print("Native inline history \(checks) assertions passed")
    }
}
