import Foundation

/// 执行真实生产 store；回执与 Workspace 快照分步到达，不通过计时猜测上下文。
enum NativeComposerPresentationSmoke {
    final class Commands { var values: [NativeCommand] = [] }
    @MainActor static func verify() {
        var assertions = 0
        func check(_ value: @autoclosure () -> Bool, _ message: String) {
            assertions += 1
            precondition(value(), message)
        }
        func fixture() -> (NativeUIStore, Commands) {
            let store = NativeUIStore(arguments: [])
            let log = Commands()
            store.sendCommand = { log.values.append($0) }
            var value = NativeSnapshot()
            value.ready = true; value.contextId = "old-context"; value.backendId = "device-a"; value.threadId = "old-thread"
            value.draft = "不能发送的旧会话草稿"; value.canSend = true; value.sidebarOpen = true
            store.receive(value)
            return (store, log)
        }
        func next(_ store: NativeUIStore, context: String = "new-context", backend: String = "device-a") -> NativeSnapshot {
            var value = store.snapshot
            value.contextId = context; value.backendId = backend; value.threadId = nil; value.draft = ""; value.messages = []
            value.ready = true; value.readOnly = false; value.pending = false; value.sidebarOpen = false; value.commandResults = nil
            return value
        }
        func acknowledged(_ value: NativeSnapshot, _ request: NativeCommand, ok: Bool = true) -> NativeSnapshot {
            var result = value
            result.commandResults = [NativeCommandResult(id: request.id, name: request.name, ok: ok, error: ok ? nil : "新建失败")]
            return result
        }
        let (ackFirst, ackLog) = fixture()
        ackFirst.command("thread.new")
        let request = ackLog.values.last!
        check(request.name == "thread.new" && ackFirst.awaitingNewConversation, "新对话必须先登记 presentation intent")
        check(!ackFirst.composerCanEdit && !ackFirst.composerCanSend && !ackFirst.composerCanInterrupt, "等待新上下文期间旧 composer 全部禁操作")
        ackFirst.composerText = "错误覆盖"
        ackFirst.command("message.send")
        ackFirst.command("model.select", ["value": .string("other")])
        ackFirst.command("attachment.pick", ["kind": .string("files")])
        check(ackFirst.draft == "不能发送的旧会话草稿" && ackLog.values.count == 1, "等待时不能编辑、发送、改模型或打开旧上下文附件")
        var oldACK = acknowledged(ackFirst.snapshot, request)
        oldACK.sidebarOpen = false
        ackFirst.receive(oldACK)
        check(ackFirst.awaitingNewConversation && ackFirst.composerPresentation == nil && ackFirst.sidebarOpen, "ACK 比 effect 早到不能关闭 sidebar 暴露旧草稿")
        oldACK.threadId = nil
        ackFirst.receive(oldACK)
        check(ackFirst.awaitingNewConversation, "即使旧上下文 threadId 已空仍须 contextId 改变")
        var loading = next(ackFirst); loading.ready = false
        ackFirst.receive(loading)
        check(ackFirst.awaitingNewConversation && ackFirst.composerPresentation == nil, "新 context 尚未 ready 不得聚焦")
        var pending = next(ackFirst); pending.pending = true
        ackFirst.receive(pending)
        check(ackFirst.composerPresentation == nil, "业务 pending 不得呈现编辑入口")
        var readOnly = next(ackFirst); readOnly.readOnly = true
        ackFirst.receive(readOnly)
        check(ackFirst.composerPresentation == nil, "只读新 context 不得聚焦")
        ackFirst.receive(next(ackFirst))
        check(!ackFirst.awaitingNewConversation && !ackFirst.sidebarOpen && ackFirst.draft.isEmpty, "权威空会话准备完成后才关闭 sidebar 并接受新草稿")
        check(ackFirst.consumeComposerPresentation(contextID: "old-context") == nil && ackFirst.composerPresentation != nil, "旧 View 不能消费新 View 的 intent")
        check(ackFirst.consumeComposerPresentation(contextID: "new-context") == .focus, "同一 UUID 成功且权威新上下文才聚焦")
        check(ackFirst.consumeComposerPresentation(contextID: "new-context") == nil, "聚焦只消费一次")
        ackFirst.receive(acknowledged(next(ackFirst), request))
        check(ackFirst.composerPresentation == nil, "重复回执不能重新弹键盘")

        let (contextFirst, contextLog) = fixture()
        contextFirst.perform(NativeCommand(id: "display-template", name: "thread.new", params: ["backendId": .string("device-b"), "cwd": .string("/tmp/project")]))
        let contextRequest = contextLog.values.last!
        check(contextRequest.id != "display-template" && contextRequest.params["cwd"] == .string("/tmp/project"), "每次启动分配请求 UUID，项目上下文使用业务命令原值")
        contextFirst.receive(next(contextFirst, backend: "device-b"))
        check(contextFirst.awaitingNewConversation && contextFirst.composerPresentation == nil, "context 先到也必须等待 ACK")
        var wrongID = next(contextFirst, backend: "device-b")
        wrongID.commandResults = [NativeCommandResult(id: "stale-id", name: "thread.new", ok: true)]
        contextFirst.receive(wrongID)
        check(contextFirst.composerPresentation == nil, "不同 UUID 不能确认")
        wrongID.commandResults = [NativeCommandResult(id: contextRequest.id, name: "thread.open", ok: true)]
        contextFirst.receive(wrongID)
        check(contextFirst.composerPresentation == nil, "同 UUID 错误命令名不能确认")
        contextFirst.receive(acknowledged(next(contextFirst, backend: "device-b"), contextRequest))
        check(contextFirst.consumeComposerPresentation(contextID: "new-context") == .focus, "context→ACK 顺序同样可确认")

        for invalidation in ["wrong-target", "old-thread", "failure", "cancel", "navigate", "sidebar", "superseded"] {
            let (store, log) = fixture()
            store.startNewConversation(presentation: .attachments, params: ["backendId": .string("device-b"), "cwd": .string("/tmp/project")])
            let initial = log.values.last!
            var value = acknowledged(next(store, backend: "device-b"), initial)
            switch invalidation {
            case "wrong-target": value.backendId = "device-c"
            case "old-thread": value.threadId = "another-thread"
            case "failure": value = acknowledged(store.snapshot, initial, ok: false)
            case "cancel": store.cancelComposerPresentation()
            case "navigate": store.command("thread.open", ["backendId": .string("device-a"), "threadId": .string("other")])
            case "sidebar": store.sidebarIsOpen = false
            default: store.startNewConversation(presentation: .focus); value.contextId = "old-context"; value.threadId = "old-thread"
            }
            store.receive(value)
            check(store.composerPresentation == nil && !store.attachmentOpen, "\(invalidation) 不得呈现附件或聚焦")
            if invalidation == "superseded" { store.cancelComposerPresentation() }
            store.receive(acknowledged(next(store, context: "later-context", backend: "device-b"), initial))
            check(store.composerPresentation == nil && !store.attachmentOpen, "\(invalidation) 后旧成功回执不能恢复 intent")
        }
        let (staleView, staleLog) = fixture()
        staleView.command("thread.new")
        staleView.receive(acknowledged(next(staleView), staleLog.values.last!))
        var otherThread = next(staleView, context: "different-context"); otherThread.threadId = "other"
        staleView.receive(otherThread)
        check(staleView.consumeComposerPresentation(contextID: "different-context") == nil, "已准备的 intent 在切去其他会话后失效")

        let (sameContextSwitch, sameContextLog) = fixture()
        sameContextSwitch.command("thread.new")
        var sameContextOther = sameContextSwitch.snapshot; sameContextOther.threadId = "different-thread"
        sameContextSwitch.receive(sameContextOther)
        check(!sameContextSwitch.awaitingNewConversation, "即使 context 延后更新，切去其他 thread 也要取消 intent")
        sameContextSwitch.receive(acknowledged(next(sameContextSwitch), sameContextLog.values.last!))
        check(sameContextSwitch.composerPresentation == nil, "被其他 thread 取消后晚到 ACK 不能聚焦")
        let (presentationBlocked, presentationLog) = fixture()
        presentationBlocked.command("thread.new")
        presentationBlocked.receive(acknowledged(next(presentationBlocked), presentationLog.values.last!))
        var noLongerEditable = next(presentationBlocked); noLongerEditable.pending = true
        presentationBlocked.receive(noLongerEditable)
        presentationBlocked.receive(next(presentationBlocked))
        check(presentationBlocked.composerPresentation == nil, "呈现前 gate 关闭就取消 event，后续不能突然弹键盘")
        let (cannotSend, cannotSendLog) = fixture()
        var sendingBlocked = cannotSend.snapshot; sendingBlocked.canSend = false
        cannotSend.receive(sendingBlocked); cannotSend.command("message.send")
        check(cannotSendLog.values.isEmpty, "是否允许发送以权威 canSend 为准")

        for presentation: NativeComposerPresentation in [.attachments, .photos, .files] {
            let (store, log) = fixture()
            store.startNewConversation(presentation: presentation)
            let start = log.values.last!
            store.receive(acknowledged(next(store), start))
            check(store.consumeComposerPresentation(contextID: "new-context") == presentation, "附件呈现也经过同一确认")
            if presentation == .attachments {
                check(store.attachmentOpen && log.values.count == 1, "附件菜单只在新 context 显示，不提前调用 picker")
                store.setComposerAttachmentOpen(false, contextID: "old-context")
                check(store.attachmentOpen && store.composerAttachmentIsOpen(contextID: "new-context"), "旧输入栏销毁不能清除新建附件消费后的呈现请求")
                check(!store.composerAttachmentIsOpen(contextID: "old-context"), "旧按钮也不能读取新会话呈现状态作为重开请求")
                store.setComposerAttachmentOpen(false, contextID: "new-context")
            } else {
                check(log.values.count == 2 && log.values.last?.name == "attachment.pick", "照片/文件消费时只派发一次 picker")
                check(log.values.last?.params["contextId"] == .string("new-context"), "picker 保留现有业务 context gate")
                check(log.values.last?.params["kind"] == .string(presentation == .photos ? "photos" : "files"), "照片与文件 intent 不混淆")
            }
            store.receive(acknowledged(next(store), start))
            check(store.consumeComposerPresentation(contextID: "new-context") == nil && !store.attachmentOpen, "重复回执不能重开附件菜单或 picker")
            check(log.values.count == (presentation == .attachments ? 1 : 2), "重复消费不派发第二次附件命令")
        }

        for mode in ["not-ready", "read-only", "pending"] {
            let (store, log) = fixture()
            var value = store.snapshot
            value.ready = mode != "not-ready"; value.readOnly = mode == "read-only"; value.pending = mode == "pending"
            store.receive(value)
            let draft = store.draft
            store.composerText = "不允许编辑"
            for name in ["model.select", "effort.select", "speed.select", "permission.select", "attachment.pick", "attachment.remove", "location.insert", "draft.save", "message.send"] {
                store.command(name, ["value": .string("authoritative-choice"), "kind": .string("files")])
            }
            store.command("panel.open", ["id": .string("mentions")])
            check(!store.composerCanEdit && !store.composerCanSend && store.draft == draft && log.values.isEmpty, "\(mode) composer/配置/附件必须使用真实 gate")
        }
        let (busy, busyLog) = fixture()
        var running = busy.snapshot; running.busy = true; running.canInterrupt = true
        busy.receive(running)
        check(busy.composerCanSend && busy.composerCanInterrupt, "busy+draft 同时保留排队发送与停止")
        busy.command("message.send"); busy.command("turn.stop")
        check(busyLog.values.map(\.name) == ["message.send", "turn.stop"], "排队与停止独立派发，不互相等待")

        let (navigation, _) = fixture()
        var devices = navigation.snapshot
        devices.listBackendId = "all"
        devices.backends = [NativeBackend(id: "all", title: "All", connected: true), NativeBackend(id: "real", title: "Real", connected: false)]
        navigation.receive(devices)
        check(navigation.navigationBackends.map(\.id) == ["real"] && !navigation.listBackendConnected, "All 过滤伪设备，连接点不能信任 all.connected")
        devices.backends[1].connected = true; navigation.receive(devices)
        check(navigation.listBackendConnected, "All 连接状态由真实设备推导")

        let reference = NativeUIStore(arguments: ["--native-ui-reference-visual"])
        var referenceCommands = 0; reference.sendCommand = { _ in referenceCommands += 1 }
        let before = reference.snapshot.contextId
        reference.draft = "旧草稿"
        reference.startNewConversation(presentation: .attachments)
        check(reference.snapshot.contextId != before && reference.snapshot.threadId == nil && reference.draft.isEmpty, "Reference 本地模拟新的权威空 context")
        check(reference.consumeComposerPresentation(contextID: reference.snapshot.contextId) == .attachments && reference.attachmentOpen, "Reference 经同一双门确认后可呈现附件")
        check(referenceCommands == 0, "Reference 不接触真实桥或网关")
        print("Native composer presentation \(assertions) assertions passed")
    }
}
