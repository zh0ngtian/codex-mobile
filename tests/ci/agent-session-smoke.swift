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
        session.loadMoreProject(session.scopedProjects.first { session.projectDisplayName($0) == "同名项目" }!)
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
        state.queued = [NativeNavigationItem(id: "queue:raw", title: "附件队列", inputText: "原始文本", queueState: "queued", attachmentCount: 2)]
        publish(state)
        let attachmentQueue = session.selectedConversation!.queue.first!
        let queueEditing = Task { await session.editQueuedMessageAndWait(conversationID: selected, id: attachmentQueue.id, text: "") }
        for _ in 0..<30 { if commands.last?.name == "queue.edit" { break }; await Task.yield() }
        precondition(commands.last?.name == "queue.edit" && commands.last?.params["value"] == .string(""), "真实仅附件队列必须允许清空正文后保存")
        let queueEdit = commands.last!
        state.commandResults = [NativeCommandResult(id: queueEdit.id, name: queueEdit.name, ok: true, contextId: state.contextId)]
        publish(state)
        let queueSaved = await queueEditing.value
        precondition(queueSaved, "仅附件编辑必须等待真实业务确认")
        let remote = "data:image/png;base64,aGVsbG8="
        state.attachments = [NativeAttachment(id: "file:opaque", name: "preview.png", imageURL: remote, type: "image/png")]
        publish(state)
        precondition(session.composer.attachments.first?.remoteURL == remote)
        session.removeAttachment(session.composer.attachments.first!.id)
        precondition(commands.last?.params["id"] == .string("file:opaque"))
        session.importAttachments([AttachmentItem(name: "测试.txt", data: Data("真实文件".utf8), mimeType: "text/plain")])
        precondition(commands.last?.name == "attachment.import", "附件必须进入现有上传业务")
        state.approvalPanel = NativePanel(id: "approval:number:123", title: "真实审批", items: [NativePanelItem(id: "approval-thread-id", kind: "text", text: "thread:arbitrary"), NativePanelItem(id: "approval:reason", kind: "text", text: "请求写入文件权限"), NativePanelItem(id: "approval:grantRoot", kind: "text", text: "/write/root"), NativePanelItem(id: "permissions:write", kind: "text", text: "/extra/path"), NativePanelItem(id: "permissions:entry:0", kind: "text", text: "/extra/path"), NativePanelItem(id: "approval-decision:0", kind: "action", value: "\"accept\"", command: NativeCommand(name: "approval.decide", params: ["requestKey": .string("number:123"), "index": .number(0)]))])
        publish(state)
        precondition(session.approvals.first?.decisions == [.allowOnce])
        precondition(session.approvals.first?.paths == ["/write/root", "/extra/path"], "真实fileChange写入根目录和附加权限路径必须完整保留且去重")
        let approval = session.approvals.first!.id
        let approvalTask = Task { await session.submitApproval(approval, decision: .allowOnce) }
        for _ in 0..<30 { if commands.last?.name == "approval.decide" { break }; await Task.yield() }
        let decision = commands.last!
        precondition(decision.params["requestKey"] == .string("number:123") && session.approvals.count == 1, "ACK前不能本地删除审批")
        state.commandResults = [NativeCommandResult(id: decision.id, name: decision.name, ok: false, contextId: state.contextId, error: "审批提交失败")]
        publish(state); await approvalTask.value
        precondition(session.approvals.first?.error == "审批提交失败" && session.approvals.first?.submitting == false)
        state.approvalPanel = NativePanel(id: "approval:number:multi-host", title: "真实网络审批", items: [NativePanelItem(id: "approval-thread-id", kind: "text", text: "thread:arbitrary"), NativePanelItem(id: "host-one", kind: "action", title: "允许并记住主机：one.example", value: "{\"applyNetworkPolicyAmendment\":{\"network_policy_amendment\":{\"action\":\"allow\",\"host\":\"one.example\"}}}", command: NativeCommand(name: "approval.decide", params: ["requestKey": .string("number:multi-host"), "index": .number(0)])), NativePanelItem(id: "host-two", kind: "action", title: "允许并记住主机：two.example", value: "{\"applyNetworkPolicyAmendment\":{\"network_policy_amendment\":{\"action\":\"allow\",\"host\":\"two.example\"}}}", command: NativeCommand(name: "approval.decide", params: ["requestKey": .string("number:multi-host"), "index": .number(1)]))])
        publish(state)
        let ambiguousRequest = session.approvals.first!.id
        let beforeAmbiguous = commands.count
        let ambiguous = Task { await session.submitApproval(ambiguousRequest, decision: .rememberHost) }
        for _ in 0..<20 { await Task.yield() }
        precondition(commands.count == beforeAmbiguous, "同语义多个审批决定不能静默只选择最后一个主机")
        await ambiguous.value
        let hostChoices = session.approvals.first!.choices
        precondition(hostChoices.count == 2 && Set(hostChoices.map(\.id)).count == 2 && hostChoices[0].title.contains("one.example") && hostChoices[1].title.contains("two.example"), "每个真实主机决定必须保留独立身份和目标标题")
        let beforeExact = commands.count
        let exact = Task { await session.submitApproval(ambiguousRequest, choiceID: hostChoices[0].id) }
        for _ in 0..<30 { if commands.count > beforeExact { break }; await Task.yield() }
        let exactCommand = commands.last!
        precondition(exactCommand.params["requestKey"] == .string("number:multi-host") && exactCommand.params["index"] == .number(0), "选择第一个主机不能改为提交最后一个主机index")
        state.commandResults = [NativeCommandResult(id: exactCommand.id, name: exactCommand.name, ok: true, contextId: state.contextId)]
        publish(state); await exact.value
        state.approvalPanel = nil; state.commandResults = nil; state.attachments = []; state.queued = []
        publish(state)
        let priorGroups = state.groups
        state.search = "真实搜索"; state.groups = [NativeGroup(id: "search", title: "搜索结果", items: [NativeNavigationItem(id: "found", title: "搜索到的真实会话", command: openB, backendId: "device:beta", threadId: "thread:arbitrary", cwd: "/work/b")], actions: [NativePanelItem(id: "search-retry", kind: "action", command: NativeCommand(name: "navigation.refresh"))], category: "search", subtitle: "真实查询失败", loading: "loading")]
        publish(state)
        precondition(session.navigationLoading && session.navigationError == "真实查询失败", "搜索进度和真实错误不能伪装成没有匹配")
        session.retryNavigation()
        precondition(commands.last?.name == "navigation.refresh", "导航重试必须调用真实原始业务动作")
        precondition(!session.scopedProjects.isEmpty && session.scopedProjects.flatMap { session.projectConversations($0) }.contains { $0.title == "搜索到的真实会话" }, "仅search分组的有项目结果不能消失")
        state.groups = [NativeGroup(id: "list-error", title: "真实列表失败", items: [NativeNavigationItem(id: "retry", title: "重试", command: NativeCommand(name: "navigation.refresh"))])]
        publish(state)
        precondition(!session.navigationLoading && session.navigationError == "真实列表失败", "普通列表真实失败也必须可见")
        session.retryNavigation()
        precondition(commands.last?.name == "navigation.refresh")
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
        state.panel = NativePanel(id: "attachment:file-raw", title: "本地真实.md", items: [NativePanelItem(id: "draft-download", kind: "file", title: "本地真实.md", value: "data:text/markdown;base64,IyBsb2NhbA=="), NativePanelItem(id: "draft-content", kind: "markdown", text: "# local", previewURL: "data:text/markdown;base64,IyBsb2NhbA==")])
        publish(state)
        precondition(session.previewItem?.name == "本地真实.md" && session.previewItem?.kind == .markdown && session.previewItem?.remoteURL == "data:text/markdown;base64,IyBsb2NhbA==", "本地文件业务预览必须将真实原字节交给AgentApp预览下载")
        state.panel = nil; publish(state)
        let aDevice = session.devices.first!.id
        session.beginNewConversation(deviceID: aDevice)
        precondition(commands.last?.name == "thread.new" && commands.last?.params["backendId"] == .string("device:alpha") && commands.last?.params["cwd"] == .string(""), "有目标设备的新会话必须提供明确cwd")
        await verifyDeviceAndImportAcknowledgements()
        await verifyDelayedDeviceForm()
        await verifyPendingProjectsAndQuestions()
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

    @MainActor static func verifyPendingProjectsAndQuestions() async {
        let store = NativeUIStore(arguments: [])
        let session = AppSession(store: store)
        var commands: [NativeCommand] = []; store.sendCommand = { commands.append($0) }
        var state = NativeSnapshot(); state.ready = true; state.backendId = "b"; state.listBackendId = "b"; state.threadId = "t"; state.contextId = "ctx"; state.connection = "online"
        state.backends = [NativeBackend(id: "b", title: "真实设备", connected: true)]
        func publish() { store.receive(state); session.receive(state) }
        publish(); state.pending = true; publish()
        precondition(!session.composerCanEdit, "真实pending期间输入必须不可编辑")
        state.pending = false; publish()
        session.beginNewConversation(deviceID: session.devices.first!.id)
        precondition(!session.composerCanEdit, "等待新会话权威上下文期间输入必须不可编辑")
        store.cancelComposerPresentation()
        state.groups = [NativeGroup(id: "search", title: "搜索结果", items: [NativeNavigationItem(id: "t", title: "无项目真实结果", command: NativeCommand(name: "thread.open", params: ["backendId": .string("b"), "threadId": .string("t")]), cwd: "")], category: "search")]
        publish()
        precondition(session.selectedConversation?.project == nil, "空cwd必须归一化为无项目以免搜索结果被UI漏掉")
        let projectless = NativeNavigationItem(id: "t", title: "无项目真实会话", command: NativeCommand(name: "thread.open", params: ["backendId": .string("b"), "threadId": .string("t")]), cwd: "")
        state.groups = [NativeGroup(id: "real-projectless", title: "无项目", items: [projectless], command: NativeCommand(name: "project.toggle", params: ["backendId": .string("b"), "cwd": .string("codex-mobile://projectless")]), category: "project", cwd: "codex-mobile://projectless")]
        publish()
        precondition(session.scopedProjects.isEmpty && session.conversation(session.selectedConversationID!) != nil, "非搜索无项目会话不得变成项目组或丢弃真实会话数据")
        state.groups = [NativeGroup(id: "search", title: "搜索结果", items: [projectless], category: "search")]
        publish()
        precondition(session.visibleConversations.contains { $0.id == session.selectedConversationID && $0.project == nil }, "无项目会话在真实搜索结果中仍须可见")
        state.groups = (0..<3).map { index in
            let cwd = "/root\(index)/app"
            return NativeGroup(id: "project-\(index)", title: "app", items: [NativeNavigationItem(id: "thread-\(index)", title: "真实会话\(index)", command: NativeCommand(name: "thread.open", params: ["backendId": .string("b"), "threadId": .string("thread-\(index)")]), cwd: cwd)], command: NativeCommand(name: "project.toggle", params: ["backendId": .string("b"), "cwd": .string(cwd)]), actions: [NativePanelItem(id: "more-\(index)", kind: "action", command: NativeCommand(name: "project.more", params: ["backendId": .string("b"), "cwd": .string(cwd)]))], category: "project", backendId: "b", cwd: cwd)
        }
        publish()
        precondition(Set(session.scopedProjects) == Set(["project-0", "project-1", "project-2"]), "同设备同basename的三个项目必须按真实group身份独立")
        for index in 0..<3 {
            let key = "project-\(index)"
            precondition(session.projectDisplayName(key) == "app" && session.projectConversations(key).count == 1)
            session.toggleProject(key)
            precondition(commands.last?.params["cwd"] == .string("/root\(index)/app"))
            session.loadMoreProject(key)
            precondition(commands.last?.name == "project.more" && commands.last?.params["cwd"] == .string("/root\(index)/app"))
        }
        let panel = NativePanel(id: "approval:number:question", title: "真实问题", items: [NativePanelItem(id: "approval-thread-id", kind: "text", text: "t"), NativePanelItem(id: "q", kind: "section", title: "校验", children: [NativePanelItem(id: "q:prompt", kind: "text", text: "请输入限制"), NativePanelItem(id: "q:answer", kind: "secureField", value: "", command: NativeCommand(name: "approval.answer", params: ["requestKey": .string("number:question"), "questionId": .string("q"), "custom": .bool(true)]))]), NativePanelItem(id: "submit", kind: "action", command: NativeCommand(name: "approval.submit", params: ["requestKey": .string("number:question")])), NativePanelItem(id: "dismiss", kind: "action", command: NativeCommand(name: "approval.dismiss", params: ["requestKey": .string("number:question")]))])
        state.approvalCount = 1; state.approvalPanel = panel; state.conversationActions = [NativePanelItem(id: "reopen", kind: "action", command: NativeCommand(name: "approval.reopen"))]
        publish()
        let question = session.questions.first!; let field = question.questions.first!
        session.setAnswer(requestID: question.id, questionID: field.id, answer: QuestionAnswer(custom: true, text: "只留内存的私密答案"))
        session.postponeQuestion(); publish()
        precondition(session.activeQuestionID == nil, "稍后回答后旧panel快照不得自动重新弹出")
        state.approvalPanel = nil; publish()
        precondition(session.canReopenPendingRequests && session.hasDeferredQuestion, "真实pending仍存在时必须保留继续回答入口")
        session.reopenPendingRequests()
        precondition(commands.last?.name == "approval.reopen", "继续回答必须调用真实reopen动作")
        state.approvalPanel = panel; publish()
        precondition(session.questions.first?.answers[field.id]?.text == "只留内存的私密答案" && session.activeQuestionID == question.id, "恢复真实同请求时必须恢复内存答案")
        state.approvalCount = 0; state.approvalPanel = nil; publish()
        precondition(!session.canReopenPendingRequests && !session.hasDeferredQuestion)
        state.approvalCount = 1; state.approvalPanel = panel; publish()
        precondition(session.questions.first?.answers.isEmpty == true, "真实请求解决后必须清除保密内存答案")
        func submittingPanel(_ busy: Bool, error: String? = nil) -> NativePanel {
            var value = panel
            func project(_ item: NativePanelItem) -> NativePanelItem { var item = item; if item.command != nil { item.disabled = busy }; item.children = item.children?.map(project); return item }
            value.items = value.items.map(project)
            if busy { value.items.append(NativePanelItem(id: "approval-pending", kind: "text", text: "正在提交，请等待确认…")) }
            if let error { value.items.append(NativePanelItem(id: "approval-error", kind: "text", text: error)) }
            return value
        }
        for (failure, uncertain) in [("网络提交失败", false), ("操作结果待确认", true)] {
            let pendingQuestion = session.questions.first!
            let retained = "失败后保留：" + failure
            session.setAnswer(requestID: pendingQuestion.id, questionID: field.id, answer: QuestionAnswer(custom: true, text: retained))
            var replyCommand: NativeCommand?
            store.sendCommand = { command in
                commands.append(command)
                if command.name == "approval.submit" { replyCommand = command; return }
                state.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: state.contextId)]
                publish()
            }
            let replying = Task { await session.submitAnswers(pendingQuestion.id) }
            for _ in 0..<50 { if replyCommand != nil { break }; await Task.yield() }
            state.approvalPanel = submittingPanel(true); publish()
            precondition(replyCommand != nil && state.approvalPanel?.items.first(where: { $0.id == "submit" })?.disabled == true && session.questions.first?.submitting == true && session.questions.first?.answers[field.id]?.text == retained, "慢ACK未确认前必须保留答案并锁住表单")
            session.setAnswer(requestID: pendingQuestion.id, questionID: field.id, answer: QuestionAnswer(custom: true, text: "不能覆盖发送中的答案"))
            session.postponeQuestion()
            precondition(session.activeQuestionID == pendingQuestion.id && session.questions.first?.answers[field.id]?.text == retained, "慢ACK期间不能编辑或隐藏发送中的表单")
            state.approvalPanel = submittingPanel(uncertain, error: failure)
            state.commandResults = [NativeCommandResult(id: replyCommand!.id, name: "approval.submit", ok: false, contextId: state.contextId, error: failure)]
            publish(); await replying.value
            precondition(session.questions.first?.submitting == uncertain && session.questions.first?.answers[field.id]?.text == retained && session.questions.first?.error == failure, "失败ACK必须保留答案并服从业务panel的真实提交锁定状态")
            if uncertain {
                let beforeRetry = commands.count
                session.setAnswer(requestID: pendingQuestion.id, questionID: field.id, answer: QuestionAnswer(custom: true, text: "不能改待确认答案"))
                session.postponeQuestion(); await session.submitAnswers(pendingQuestion.id)
                precondition(commands.count == beforeRetry && session.activeQuestionID == pendingQuestion.id && session.questions.first?.answers[field.id]?.text == retained, "uncertain权威panel未解锁前不得改答、稍后或重发")
                state.approvalPanel = submittingPanel(false, error: failure); publish()
                precondition(session.questions.first?.submitting == false, "业务权威解除提交锁后才允许重试")
            }
            session.postponeQuestion(); state.approvalPanel = nil; publish()
            session.reopenPendingRequests(); state.approvalPanel = panel; publish()
            precondition(session.questions.first?.answers[field.id]?.text == retained && session.questions.first?.submitting == false, "失败或待确认后重新打开不能丢答案或一直锁住")
        }
        let resolved = session.questions.first!
        session.setAnswer(requestID: resolved.id, questionID: field.id, answer: QuestionAnswer(custom: true, text: "投影收敛前仍须保留"))
        store.sendCommand = { command in
            commands.append(command)
            state.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: state.contextId)]
            publish()
        }
        await session.submitAnswers(resolved.id)
        precondition(session.questions.first?.answers[field.id]?.text == "投影收敛前仍须保留", "命令ACK先到但权威请求仍在时不能丢答案或屏蔽同请求")
        publish()
        precondition(!session.questions.isEmpty, "同一权威请求不能被本地成功标记永远屏蔽")
        state.approvalPanel = nil; state.approvalCount = 0; publish()
        precondition(session.questions.isEmpty && !session.hasDeferredQuestion, "权威请求消失后才清理已确认答案")
    }

}
