import Foundation

@main
struct AgentSessionSmoke {
    @MainActor static func main() async {
        let empty = AppSession()
        precondition(empty.devices.isEmpty && empty.conversations.isEmpty && empty.accountQuotas.isEmpty, "真实网关就绪前不得填充示例状态")
        let store = NativeUIStore(arguments: [])
        let session = AppSession(store: store)
        var commands: [NativeCommand] = []
        store.sendCommand = { commands.append($0) }
        var state = NativeSnapshot()
        state.ready = true; state.connection = "online"; state.backendId = "device:alpha"; state.listBackendId = "all"; state.contextId = "opaque-context-1"; state.threadId = "thread:arbitrary"; state.title = "真实会话"; state.canSend = true
        state.backends = [NativeBackend(id: "device:alpha", title: "设备 A", connected: true, approvalCount: 3), NativeBackend(id: "device:beta", title: "设备 B", connected: true)]
        let openA = NativeCommand(name: "thread.open", params: ["backendId": .string("device:alpha"), "threadId": .string("thread:arbitrary")])
        let openB = NativeCommand(name: "thread.open", params: ["backendId": .string("device:beta"), "threadId": .string("thread:arbitrary")])
        state.groups = [NativeGroup(id: "ga", title: "同名项目", items: [NativeNavigationItem(id: "nav-a", title: "会话 A", command: openA, backendId: "device:alpha", threadId: "thread:arbitrary", cwd: "/work/a")], command: NativeCommand(name: "project.toggle", params: ["backendId": .string("device:alpha"), "cwd": .string("/work/a")]), actions: [NativePanelItem(id: "more-a", kind: "action", command: NativeCommand(name: "project.more", params: ["backendId": .string("device:alpha"), "cwd": .string("/work/a")]))], category: "project"), NativeGroup(id: "gb", title: "同名项目", items: [NativeNavigationItem(id: "nav-b", title: "会话 B", command: openB, backendId: "device:beta", threadId: "thread:arbitrary", cwd: "/work/b")], command: NativeCommand(name: "project.toggle", params: ["backendId": .string("device:beta"), "cwd": .string("/work/b")]), category: "project", subtitle: "设备 B")]
        state.models = [NativeOption(id: "model/raw", title: "真实模型", value: "model/raw")]; state.modelValue = "model/raw"
        state.efforts = [NativeOption(id: "effort/raw", title: "真实强度", value: "effort/raw")]; state.effortValue = "effort/raw"
        state.messages = [NativeMessage(id: "wire-message:1", role: "user", text: "真实正文", blocks: [NativePanelItem(id: "user-image", kind: "image", title: "原图.png", value: "data:image/png;base64,aGVsbG8=")])]
        func publish(_ snapshot: NativeSnapshot) { store.receive(snapshot); session.receive(snapshot) }
        publish(state)
        precondition(session.pendingCount(for: session.devices.first!.id) == 3, "跨设备待处理计数必须来自真实后端汇总")
        precondition(session.conversations.count == 2, "同一 thread 字符串在不同设备必须保持独立")
        precondition(session.selectedConversation?.messages.first?.text == "真实正文")
        precondition(session.selectedConversation?.messages.first?.attachments.first?.remoteURL == "data:image/png;base64,aGVsbG8=", "用户消息真实图片不能从AgentApp附件卡消失")
        let selected = session.selectedConversationID!
        session.open(selected)
        precondition(commands.last?.params["threadId"] == .string("thread:arbitrary") && commands.last?.params["backendId"] == .string("device:alpha"), "不得拆分原始标识中的冒号")
        precondition(session.scopedProjects.count == 2 && session.scopedProjects.allSatisfy { session.projectConversations($0).count == 1 }, "同名跨设备项目需独立列出已加载会话")
        session.loadMoreProject("同名项目")
        precondition(commands.last?.name == "project.more" && commands.last?.params["cwd"] == .string("/work/a"))
        let wasPinned = session.conversation(selected)!.isPinned
        session.togglePin(selected)
        precondition(session.conversation(selected)!.isPinned == wasPinned, "关注状态必须等待权威快照")
        session.composer.text = "尚未确认的输入"
        precondition(commands.last?.name == "draft.set")
        publish(state)
        precondition(session.composer.text == "尚未确认的输入", "旧 draft revision 不得覆盖输入")
        let submission = session.submitCurrent()
        precondition(submission == .started(selected))
        for _ in 0..<30 { if commands.last?.name == "message.send" { break }; await Task.yield() }
        let send = commands.last!
        precondition(send.name == "message.send" && session.composer.text == "尚未确认的输入", "ACK 前不得清空输入")
        state.commandResults = [NativeCommandResult(id: send.id, name: send.name, ok: false, contextId: state.contextId, error: "网关拒绝测试")]
        publish(state)
        for _ in 0..<5 { await Task.yield() }
        precondition(!session.submissionPending && session.composer.text == "尚未确认的输入" && session.toast == "网关拒绝测试", "发送失败必须保留输入并呈现真实错误")
        state.queued = [NativeNavigationItem(id: "queue:raw", title: "队列正文", inputText: "队列原文", queueState: "uncertain")]
        publish(state)
        precondition(session.selectedConversation?.queue.first?.state == .uncertain, "队列状态必须来自真实字段")
        precondition(session.selectedConversation?.queue.first?.configuration.model == "", "没有返回的队列模型不能套用当前模型")
        let remote = "data:image/png;base64,aGVsbG8="
        state.attachments = [NativeAttachment(id: "file:opaque", name: "preview.png", imageURL: remote, type: "image/png")]
        publish(state)
        precondition(session.composer.attachments.first?.remoteURL == remote)
        session.removeAttachment(session.composer.attachments.first!.id)
        precondition(commands.last?.params["id"] == .string("file:opaque"))
        session.importAttachments([AttachmentItem(name: "测试.txt", data: Data("真实文件".utf8), mimeType: "text/plain")])
        precondition(commands.last?.name == "attachment.import", "附件必须进入现有上传业务")
        state.approvalPanel = NativePanel(id: "approval:number:123", title: "真实审批", items: [NativePanelItem(id: "approval-thread-id", kind: "text", text: "thread:arbitrary"), NativePanelItem(id: "approval:reason", kind: "text", text: "请求命令权限"), NativePanelItem(id: "approval-decision:0", kind: "action", value: "\"accept\"", command: NativeCommand(name: "approval.decide", params: ["requestKey": .string("number:123"), "index": .number(0)]))])
        publish(state)
        precondition(session.approvals.first?.decisions == [.allowOnce])
        let approval = session.approvals.first!.id
        let approvalTask = Task { await session.submitApproval(approval, decision: .allowOnce) }
        for _ in 0..<30 { if commands.last?.name == "approval.decide" { break }; await Task.yield() }
        let decision = commands.last!
        precondition(decision.params["requestKey"] == .string("number:123") && session.approvals.count == 1, "ACK前不能本地删除审批")
        state.commandResults = [NativeCommandResult(id: decision.id, name: decision.name, ok: false, contextId: state.contextId, error: "审批提交失败")]
        publish(state); await approvalTask.value
        precondition(session.approvals.first?.error == "审批提交失败" && session.approvals.first?.submitting == false)
        state.approvalPanel = nil; state.commandResults = nil; state.attachments = []; state.queued = []
        publish(state)
        let priorGroups = state.groups
        state.search = "真实搜索"; state.groups = [NativeGroup(id: "search", title: "搜索结果", items: [NativeNavigationItem(id: "found", title: "搜索到的真实会话", command: openB, backendId: "device:beta", threadId: "thread:arbitrary", cwd: "/work/b")], category: "search")]
        publish(state)
        precondition(!session.scopedProjects.isEmpty && session.scopedProjects.flatMap { session.projectConversations($0) }.contains { $0.title == "搜索到的真实会话" }, "仅search分组的有项目结果不能消失")
        state.search = ""; state.groups = priorGroups; state.threadId = nil; state.contextId = "new-context"; state.draftRevision = 0
        publish(state)
        session.composer.project = "/real/raw-project"
        session.configurationDidChange()
        precondition(commands.last?.name == "newchat.project" && commands.last?.params["value"] == .string("/real/raw-project"), "新会话选项目必须更新现有业务目标")
        session.composer.text = "第一条消息"
        _ = session.submitCurrent()
        for _ in 0..<30 { if commands.last?.name == "message.send" { break }; await Task.yield() }
        let firstSend = commands.last!
        session.composer.text = "发送期间写的下一条"
        state.threadId = "created:opaque"; state.draft = ""; state.draftRevision = 1
        state.commandResults = [NativeCommandResult(id: firstSend.id, name: firstSend.name, ok: true, contextId: state.contextId)]
        publish(state)
        for _ in 0..<5 { await Task.yield() }
        precondition(session.composer.text == "发送期间写的下一条" && session.rawConversationID(session.selectedConversationID!) == "created:opaque", "首条发送产生threadId时不得覆盖期间的新输入")
        state.permissions = [NativeOption(id: "default", title: "默认审批", value: "default"), NativeOption(id: "auto-review", title: "自动审核", value: "auto-review"), NativeOption(id: "read-only", title: "只读", value: "read-only"), NativeOption(id: "full-access", title: "完全访问", value: "full-access")]
        state.permissionValue = "auto-review"; publish(state)
        precondition(session.composer.configuration.permission == .automatic && session.currentCapabilities.permissions == [.ask, .automatic, .readOnly, .fullAccess], "真实权限id与顺序必须完整保留")
        var collision = state
        collision.threadId = nil
        collision.groups = [NativeGroup(id: "opaque", title: "真实标识", items: [NativeNavigationItem(id: "one", title: "不应合并 A", command: NativeCommand(name: "thread.open", params: ["backendId": .string("a:b"), "threadId": .string("c")])), NativeNavigationItem(id: "two", title: "不应合并 B", command: NativeCommand(name: "thread.open", params: ["backendId": .string("a"), "threadId": .string("b:c")]))])]
        publish(collision)
        precondition(session.conversations.count == 2 && Set(session.conversations.map(\.id)).count == 2, "原始标识拼接不能使不同backend/thread组合发生碰撞")
        publish(state)
        state.sidebarOpen = true; publish(state)
        session.searchVisible = true; session.sidebarVisible = false
        precondition(!session.searchVisible && session.searchText.isEmpty, "关闭侧栏必须收起搜索，重新打开不能自动弹键盘")
        state.panel = NativePanel(id: "drafts", title: "草稿", items: [NativePanelItem(id: "draft:raw", kind: "section", title: "截断摘要", value: "{\"backendId\":\"device:alpha\",\"cwd\":\"/project\",\"text\":\"完整草稿正文\",\"updatedAt\":1234000,\"images\":[],\"files\":[]}")])
        publish(state)
        precondition(session.drafts.first?.composition.text == "完整草稿正文" && session.drafts.first?.composition.deviceID == session.devices.first?.id && session.drafts.first?.updatedAt.timeIntervalSince1970 == 1234, "草稿展示必须保留真实目标、正文和更新时间")
        state.panel = nil; publish(state)
        let aDevice = session.devices.first!.id
        session.beginNewConversation(deviceID: aDevice)
        precondition(commands.last?.name == "thread.new" && commands.last?.params["backendId"] == .string("device:alpha") && commands.last?.params["cwd"] == .string(""), "有目标设备的新会话必须提供明确cwd")
        await verifyDeviceAndImportAcknowledgements()
        await verifyDelayedDeviceForm()
        print("Agent session smoke passed")
    }
    @MainActor static func verifyDeviceAndImportAcknowledgements() async {
        let store = NativeUIStore(arguments: [])
        let session = AppSession(store: store)
        var state = NativeSnapshot()
        state.ready = true; state.connection = "online"; state.contextId = "device-test-context"
        var commands: [NativeCommand] = []
        var saveRequest: NativeCommand?
        func publish() { store.receive(state); session.receive(state) }
        publish()
        store.sendCommand = { command in
            commands.append(command)
            switch command.name {
            case "device.add":
                state.panel = NativePanel(id: "devices", title: "添加设备", items: [NativePanelItem(id: "name", kind: "textField", value: "", command: NativeCommand(name: "device.change", params: ["field": .string("name"), "draftId": .string("form:opaque")])), NativePanelItem(id: "gatewayUrl", kind: "secureField", value: "", command: NativeCommand(name: "device.change", params: ["field": .string("gatewayUrl"), "draftId": .string("form:opaque")]))])
                state.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true)]
            case "device.change":
                state.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true)]
            case "device.save": saveRequest = command; return
            case "device.cancel":
                precondition(command.params["testOnly"] == .bool(true), "取消测试不能抹除设备编辑表单")
                state.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true), NativeCommandResult(id: saveRequest!.id, name: "device.save", ok: false, error: "设备测试已取消")]
            case "attachment.import":
                state.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: false, contextId: state.contextId, error: "网关拒绝附件")]
            default: return
            }
            publish()
        }
        let saving = Task { await session.saveDevice(id: nil, name: "真实设备", address: "http://127.0.0.1:18766/?token=test-fixture") }
        for _ in 0..<100 { if saveRequest != nil { break }; await Task.yield() }
        precondition(saveRequest != nil && session.deviceTesting && session.devices.isEmpty, "设备实际保存ACK前不得伪造成功设备")
        let cancelled = await session.cancelDeviceTest()
        let saved = await saving.value
        precondition(cancelled && !saved && !session.deviceTesting && session.devices.isEmpty, "真实取消ACK后不得保留后台保存或伪造成功")
        precondition(commands.filter { $0.name == "device.change" }.allSatisfy { $0.params["draftId"] == .string("form:opaque") }, "保存表单必须携带真实draft身份")
        let file = AttachmentItem(name: "尚未导入.txt", data: Data("真实数据".utf8), mimeType: "text/plain")
        let imported = await session.importAttachmentsAndWait([file])
        precondition(!imported && session.composer.attachments.isEmpty && file.data != nil && session.toast == "网关拒绝附件", "附件导入失败要保留调用者文件并等待真实确认")
    }

    @MainActor static func verifyDelayedDeviceForm() async {
        let store = NativeUIStore(arguments: [])
        let session = AppSession(store: store)
        var state = NativeSnapshot(); state.ready = true
        var command: NativeCommand?
        func publish() { store.receive(state); session.receive(state) }
        publish()
        store.sendCommand = { request in command = request; state.commandResults = [NativeCommandResult(id: request.id, name: request.name, ok: true)]; publish() }
        let editing = Task { await session.prepareDeviceEditor(nil) }
        for _ in 0..<30 { if command != nil { break }; await Task.yield() }
        for _ in 0..<10 { await Task.yield() }
        state.panel = NativePanel(id: "devices", title: "添加设备", items: [NativePanelItem(id: "name", kind: "textField", value: "", command: NativeCommand(name: "device.change", params: ["field": .string("name"), "draftId": .string("delayed-form")])), NativePanelItem(id: "gatewayUrl", kind: "secureField", value: "http://127.0.0.1/?token=fixture", command: NativeCommand(name: "device.change", params: ["field": .string("gatewayUrl"), "draftId": .string("delayed-form")]))])
        publish()
        let address = await editing.value
        precondition(address == "http://127.0.0.1/?token=fixture", "编辑表单ACK先到时必须等权威表单而非误报失败")
    }

}
