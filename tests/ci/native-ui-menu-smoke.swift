import Foundation

/// 菜单动作实际进入生产 store；只验证可观察命令与输入状态，不镜像 UIKit 实现。
enum NativeComposerMenuSmoke {
    @MainActor static func verify() {
        var assertions = 0
        func check(_ value: @autoclosure () -> Bool, _ message: String) {
            assertions += 1
            precondition(value(), message)
        }
        let context = NativeComposerMenuContext(contextID: "old-context")
        check(context.allowsExecution(contextID: "old-context", editable: true, sidebarOpen: false), "当前可编辑上下文可操作菜单")
        check(!context.allowsExecution(contextID: "next-context", editable: true, sidebarOpen: false), "换会话后旧菜单失效")
        check(!context.allowsExecution(contextID: "old-context", editable: false, sidebarOpen: false), "不可编辑时旧菜单失效")
        check(!context.allowsExecution(contextID: "old-context", editable: true, sidebarOpen: true), "侧栏展开后旧菜单失效")
        check(NativeComposerSymbols.modelTitle(model: "GPT-5", effort: "Medium", smart: "Smart") == "GPT-5 · Medium", "单一可见标签同时包含模型与推理强度")
        check(NativeComposerSymbols.modelTitle(model: "", effort: "High", smart: "智能") == "智能 · High", "缺失模型使用智能语义")
        check(NativeComposerSymbols.modelTitle(model: "GPT-5", effort: "", smart: "Smart") == "GPT-5 · Smart", "缺失强度仍提供可见智能语义")
        check(NativeComposerSymbols.modelTitle(model: " ", effort: "\n", smart: "智能") == "智能 · 智能", "空白值不能制造缺失推理标签")
        check(NativeComposerSymbols.permissionSymbol("read-only") == "hand.raised", "只读图标保留原语义")
        check(NativeComposerSymbols.permissionSymbol("full-access") == "exclamationmark.shield", "完全访问图标保留警示语义")
        check(NativeComposerSymbols.permissionSymbol("default") == "checkmark.shield", "默认审核图标保留审核语义")
        check(NativeComposerSymbols.permissionSymbol("auto") == "checkmark.shield", "自动审核使用审核语义")
        for value in [nil, "", "default", "normal"] as [String?] {
            check(!NativeComposerSymbols.isFastEnabled(value) && NativeComposerSymbols.speedSymbol(value) == "bolt.slash", "默认速度只显示关闭图标")
        }
        for value in ["fast", "priority"] {
            check(NativeComposerSymbols.isFastEnabled(value) && NativeComposerSymbols.speedSymbol(value) == "bolt.fill", "权威 Fast 和 priority 档位显示开启图标")
        }
        let expected: [(NativeComposerAttachmentAction, String, [String: NativeJSONValue], String)] = [
            (.photos, "attachment.pick", ["kind": .string("photos")], "photo"),
            (.files, "attachment.pick", ["kind": .string("files")], "paperclip"),
            (.location, "location.insert", [:], "location")
        ]
        check(NativeComposerAttachmentAction.allCases == expected.map(\.0), "附件三项顺序固定且全部列出")
        let store = NativeUIStore(arguments: [])
        var value = NativeSnapshot()
        value.ready = true; value.contextId = "old-context"; value.draft = "保留草稿与选区"
        store.receive(value)
        store.setCaretOffset(3)
        let revision = store.selectionRevision
        var commands: [NativeCommand] = []
        store.sendCommand = { commands.append($0) }
        for (action, name, params, symbol) in expected {
            check(action.symbol == symbol, "附件选项显示对应 SF Symbol")
            store.chooseComposerAttachment(action, contextID: "old-context")
            var contextual = params; contextual["contextId"] = .string("old-context")
            check(commands.last?.name == name && commands.last?.params == contextual, "附件保留现有业务动作及原上下文")
        }
        check(commands.count == 3, "每个选择只派发一次")
        check(store.draft == value.draft && store.caretOffset == 3 && store.selectionRevision == revision, "附件选择不重设草稿、光标或中文组字选区")
        store.setComposerAttachmentOpen(true, contextID: "old-context")
        check(store.attachmentOpen, "当前会话可以打开附件菜单")
        var next = value
        next.contextId = "new-context"; next.threadId = nil; next.draft = ""
        store.receive(next)
        store.setComposerAttachmentOpen(true, contextID: "new-context")
        store.setComposerAttachmentOpen(false, contextID: "old-context")
        check(store.attachmentOpen, "旧输入栏消失或旧UIKit结束回调不能清除新会话附件请求")
        store.setComposerAttachmentOpen(false, contextID: "new-context")
        check(!store.attachmentOpen, "当前菜单关闭仍须正确清理呈现状态")
        store.setComposerAttachmentOpen(true, contextID: "old-context")
        check(!store.attachmentOpen, "旧UIKit显示回调也不能重新打开新会话附件菜单")
        for state in ["stale", "read-only", "not-ready", "pending", "sidebar", "awaiting"] {
            var blocked = value
            if state == "stale" { blocked.contextId = "new-context" }
            if state == "read-only" { blocked.readOnly = true }
            if state == "not-ready" { blocked.ready = false }
            if state == "pending" { blocked.pending = true }
            blocked.sidebarOpen = state == "sidebar"
            store.receive(blocked)
            if state == "awaiting" { store.startNewConversation(presentation: .attachments) }
            store.setComposerAttachmentOpen(true, contextID: "old-context")
            check(!store.attachmentOpen, "\(state) 不能打开旧上下文附件菜单")
            let count = commands.count
            for action in NativeComposerAttachmentAction.allCases {
                store.chooseComposerAttachment(action, contextID: "old-context")
            }
            for name in ["model.select", "effort.select", "speed.select", "permission.select"] {
                store.chooseComposerOption(name, value: "choice", contextID: "old-context")
            }
            check(commands.count == count, "\(state) 不能执行旧菜单中的附件或配置动作")
            store.cancelComposerPresentation()
        }
        print("Native composer menu \(assertions) assertions passed")
    }
}
