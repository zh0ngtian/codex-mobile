import Foundation

@MainActor final class AttachmentHarness {
    let store = NativeUIStore(arguments: [])
    let session: AppSession
    var state = NativeSnapshot()
    var commands: [NativeCommand] = []
    var importSucceeds = false
    var holdsImport = false
    var onImport: (() -> Void)?
    init() {
        session = AppSession(store: store)
        state.ready = true; state.connection = "online"; state.backendId = "device"; state.contextId = "draft-a"; state.draft = "保留原文"; state.sidebarOpen = false
        store.sendCommand = { [weak self] command in
            guard let self else { return }
            self.commands.append(command)
            if command.name == "attachment.import" {
                self.onImport?()
                if self.holdsImport { return }
                if self.importSucceeds { self.state.attachments = [NativeAttachment(id: "uploaded", name: "small.txt", size: 5)] }
                self.state.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: self.importSucceeds, contextId: self.state.contextId, error: self.importSucceeds ? nil : "网关拒绝附件")]
            } else if command.name == "location.insert" {
                self.state.draft += "\n真实业务位置"
                self.state.draftRevision = (self.state.draftRevision ?? 0) + 1
                self.state.commandResults = [NativeCommandResult(id: command.id, name: command.name, ok: true, contextId: self.state.contextId)]
            } else { return }
            self.publish()
        }
        publish()
    }
    func publish() { store.receive(state); session.receive(state) }
}

@main struct ComposerAttachmentFlowSmoke {
    @MainActor static func main() async throws {
        for pending in [false, true] {
            precondition(!ComposerAttachmentSubmitGate.blocks(pending: pending, busy: true, hasContent: false), "加载、定位或失败附件待处理时仍必须允许停止当前任务")
        }
        precondition(ComposerAttachmentSubmitGate.blocks(pending: true, busy: true, hasContent: true), "待处理附件必须阻止排队新内容")
        precondition(ComposerAttachmentSubmitGate.blocks(pending: true, busy: false, hasContent: true), "待处理附件必须阻止发送")
        precondition(ComposerAttachmentSubmitGate.blocks(pending: true, busy: false, hasContent: false))
        precondition(!ComposerAttachmentSubmitGate.blocks(pending: false, busy: true, hasContent: true))
        precondition(!ComposerAttachmentSubmitGate.blocks(pending: false, busy: false, hasContent: true))
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        try verifyWebVideoFileBudget(folder: folder)
        try await verifyPhotoFileTransfer(folder: folder)
        let small = folder.appendingPathComponent("small.txt")
        try Data("small".utf8).write(to: small)
        let harness = AttachmentHarness()
        let flow = ComposerAttachmentFlow()
        let selection = flow.begin(in: harness.session)!
        let imported = await flow.loadFiles([small], selection: selection, in: harness.session, isEnglish: false)
        precondition(!imported && harness.commands.filter { $0.name == "attachment.import" }.count == 1, "系统文件选择完成后必须自动调用一次原子导入")
        precondition(harness.session.composer.text == "保留原文" && harness.session.composer.attachments.isEmpty)
        precondition(flow.items.first?.data == Data("small".utf8) && flow.error == "网关拒绝附件" && flow.canRetry, "导入失败必须保留本地数据和可见重试状态")
        harness.importSucceeds = true
        let retried = await flow.retry(in: harness.session, isEnglish: false)
        precondition(retried && flow.items.isEmpty && flow.error == nil && harness.session.composer.attachments.count == 1, "成功ACK与权威附件快照到达后才清空暂存批次")
        precondition(harness.commands.filter { $0.name == "attachment.import" }.allSatisfy { $0.params["contextId"] == .string("draft-a") })

        let cancelled = flow.begin(in: harness.session)!
        flow.cancelSelection(cancelled)
        let count = harness.commands.count
        let ignored = await flow.loadFiles([small], selection: cancelled, in: harness.session, isEnglish: false)
        precondition(!ignored && harness.commands.count == count && flow.items.isEmpty, "取消或迟到的选择器结果不能修改草稿")

        let oversized = folder.appendingPathComponent("large.bin")
        _ = FileManager.default.createFile(atPath: oversized.path, contents: nil)
        let handle = try FileHandle(forWritingTo: oversized)
        try handle.truncate(atOffset: 21 * 1_024 * 1_024); try handle.close()
        let invalid = flow.begin(in: harness.session)!
        let rejected = await flow.loadFiles([small, oversized], selection: invalid, in: harness.session, isEnglish: false)
        precondition(!rejected && harness.commands.count == count && flow.items.count == 2 && flow.items.contains { $0.state == .failed }, "任何一项失败都不能部分写入草稿")
        flow.remove(flow.items.first { $0.state == .failed }!.id)
        let remaining = await flow.retry(in: harness.session, isEnglish: false)
        precondition(remaining && flow.items.isEmpty, "移除失败项后应可重试剩余批次")

        let stale = flow.begin(in: harness.session)!
        harness.state.contextId = "draft-b"; harness.state.draft = "新草稿"; harness.publish()
        flow.reset()
        let staleCount = harness.commands.count
        let crossed = await flow.loadFiles([small], selection: stale, in: harness.session, isEnglish: false)
        precondition(!crossed && harness.commands.count == staleCount && harness.session.composer.text == "新草稿", "切换草稿后旧文件结果不能导入新context")

        var authorization: CheckedContinuation<Bool, Never>?
        let location = flow.begin(in: harness.session)!
        let locating = Task { await flow.insertLocation(selection: location, in: harness.session, isEnglish: false) {
            await withCheckedContinuation { authorization = $0 }
        } }
        for _ in 0..<100 { if authorization != nil { break }; await Task.yield() }
        precondition(authorization != nil, "点选位置必须先等待原生授权")
        harness.state.contextId = "draft-c"; harness.state.draft = "更新的草稿"; harness.publish(); flow.reset()
        authorization!.resume(returning: true)
        let obsoleteLocation = await locating.value
        precondition(!obsoleteLocation && harness.commands.count == staleCount && harness.session.composer.text == "更新的草稿", "迟到的定位授权不能写入新草稿")
        let currentLocation = flow.begin(in: harness.session)!
        let denied = await flow.insertLocation(selection: currentLocation, in: harness.session, isEnglish: false, authorize: { false })
        precondition(!denied && flow.error != nil && !flow.isBusy && harness.commands.count == staleCount, "拒绝定位权限时不写草稿，错误可见且可重新选择")
        flow.reset()
        let permittedLocation = flow.begin(in: harness.session)!
        let located = await flow.insertLocation(selection: permittedLocation, in: harness.session, isEnglish: false, authorize: { true })
        precondition(located && harness.commands.last?.name == "location.insert" && harness.commands.last?.params["contextId"] == .string("draft-c"), "授权后必须走现有定位业务并绑定原context")
        try await verifyBudgetAndInterruptedImport(small: small, folder: folder)
        print("Composer attachment flow smoke passed")
    }
    static func verifyWebVideoFileBudget(folder: URL) throws {
        let webLimit = 100 * 1_024 * 1_024
        let video = folder.appendingPathComponent("web-video.mov")
        _ = FileManager.default.createFile(atPath: video.path, contents: nil)
        let handle = try FileHandle(forWritingTo: video)
        defer { try? handle.close() }
        try handle.truncate(atOffset: UInt64(21 * 1_024 * 1_024))
        do {
            _ = try AttachmentLoader.readBoundedFile(video, size: 21 * 1_024 * 1_024, availableBytes: webLimit)
            preconditionFailure("原生默认单文件上限必须仍为20MiB")
        } catch { precondition(error as? AttachmentImportError == .fileLimit) }
        let data = try AttachmentLoader.readBoundedFile(video, size: 21 * 1_024 * 1_024, availableBytes: webLimit, perFileBytes: webLimit)
        precondition(data.count == 21 * 1_024 * 1_024, "网页视频必须沿用100MiB单文件上限，不能缩小为原生20MiB")
        try AttachmentImportLimits.validate(byteCount: webLimit, availableBytes: webLimit, perFileBytes: webLimit)
        try handle.truncate(atOffset: UInt64(webLimit + 1))
        do {
            _ = try AttachmentLoader.readBoundedFile(video, size: webLimit + 1, availableBytes: webLimit, perFileBytes: webLimit)
            preconditionFailure("网页视频超过100MiB必须在文件读取前拒绝")
        } catch { precondition(error as? AttachmentImportError == .fileLimit) }
        let growing = folder.appendingPathComponent("growing-web-video.mov")
        try Data(repeating: 0, count: 33).write(to: growing)
        do {
            _ = try AttachmentLoader.readBoundedFile(growing, size: 0, availableBytes: 32, perFileBytes: 32)
            preconditionFailure("自定义单文件上限也必须限制实际读取，不能依赖文件大小元数据")
        } catch { precondition(error as? AttachmentImportError == .fileLimit) }
    }
    static func verifyPhotoFileTransfer(folder: URL) async throws {
        let video = folder.appendingPathComponent("原片.MOV")
        let bytes = Data([0, 1, 2, 255, 10, 0])
        try bytes.write(to: video)
        let transfer = try await AttachmentPhotoTransfer.importFile(at: video)
        precondition(transfer.data == bytes, "相册视频必须保留原始字节，不按图片验证或转码")
        precondition(transfer.name == "原片.MOV" && transfer.mimeType == "video/quicktime" && transfer.kind == .video, "相册视频必须保留原始名称、类型和格式")
        let item = try await AttachmentLoader().file(at: video, id: UUID())
        precondition(item.name == "原片.MOV" && item.mimeType == "video/quicktime" && item.kind == .video && item.data == bytes)
        let boundary = folder.appendingPathComponent("boundary.mp4")
        _ = FileManager.default.createFile(atPath: boundary.path, contents: nil)
        let handle = try FileHandle(forWritingTo: boundary)
        try handle.truncate(atOffset: UInt64(AttachmentImportLimits.perFileBytes))
        let accepted = try await AttachmentPhotoTransfer.importFile(at: boundary)
        precondition(accepted.data.count == AttachmentImportLimits.perFileBytes, "20MiB视频边界可导入")
        try handle.truncate(atOffset: UInt64(AttachmentImportLimits.perFileBytes + 1)); try handle.close()
        do {
            _ = try await AttachmentPhotoTransfer.importFile(at: boundary)
            preconditionFailure("超出20MiB的视频必须在有界读取时拒绝")
        } catch { precondition(error as? AttachmentImportError == .fileLimit) }
        do {
            _ = try AttachmentLoader.readBoundedFile(boundary, size: 0, availableBytes: AttachmentImportLimits.perFileBytes)
            preconditionFailure("文件实际增长或大小信息不准确也不能绕过读取边界")
        } catch { precondition(error as? AttachmentImportError == .fileLimit) }
        do {
            _ = try await AttachmentLoader().file(at: video, id: UUID(), availableBytes: bytes.count - 1)
            preconditionFailure("视频必须计入剩余40MiB总预算")
        } catch { precondition(error as? AttachmentImportError == .batchLimit) }
        let brokenImage = folder.appendingPathComponent("broken.png")
        try bytes.write(to: brokenImage)
        do {
            _ = try await AttachmentPhotoTransfer.importFile(at: brokenImage)
            preconditionFailure("相册混选仍必须验证图片内容")
        } catch { precondition(error as? AttachmentImportError == .unreadableImage) }
    }
    @MainActor static func verifyBudgetAndInterruptedImport(small: URL, folder: URL) async throws {
        let harness = AttachmentHarness()
        let flow = ComposerAttachmentFlow()
        let twoMiB = folder.appendingPathComponent("two.bin")
        _ = FileManager.default.createFile(atPath: twoMiB.path, contents: nil)
        let handle = try FileHandle(forWritingTo: twoMiB)
        try handle.truncate(atOffset: 2 * 1_024 * 1_024); try handle.close()
        harness.state.attachments = [NativeAttachment(id: "existing", name: "existing.bin", size: 39 * 1_024 * 1_024)]
        harness.publish()
        let budgetSelection = flow.begin(in: harness.session)!
        let overBudget = await flow.loadFiles([twoMiB], selection: budgetSelection, in: harness.session, isEnglish: false)
        precondition(!overBudget && harness.commands.isEmpty && flow.items.first?.state == .failed, "总量必须包含真实已上传附件size，超过40MiB不应发送导入")
        flow.reset(); harness.state.attachments = []; harness.publish()
        harness.holdsImport = true
        let pendingSelection = flow.begin(in: harness.session)!
        var pending: Task<Bool, Never>?
        await withCheckedContinuation { observed in
            harness.onImport = { harness.onImport = nil; observed.resume() }
            pending = Task { await flow.loadFiles([small], selection: pendingSelection, in: harness.session, isEnglish: false) }
        }
        precondition(flow.isCommitting && harness.session.composer.attachments.isEmpty, "导入请求处理中不能提前填充权威附件")
        harness.state.contextId = "next-draft"; harness.state.draft = "另一个草稿"; harness.publish(); flow.reset()
        let oldResult = await pending!.value
        precondition(!oldResult && flow.items.isEmpty && flow.error == nil && harness.session.composer.text == "另一个草稿", "旧导入ACK失败或迟到不应污染新批次")
        harness.holdsImport = false; harness.importSucceeds = true
        let fresh = flow.begin(in: harness.session)!
        let success = await flow.loadFiles([small], selection: fresh, in: harness.session, isEnglish: false)
        precondition(success && harness.commands.last?.params["contextId"] == .string("next-draft"), "中断旧批次后新草稿应仍可导入")
        let oldComposer = flow.begin(in: harness.session)!
        harness.session.composer.id = UUID()
        let count = harness.commands.count
        let wrongComposer = await flow.loadFiles([small], selection: oldComposer, in: harness.session, isEnglish: false)
        precondition(!wrongComposer && harness.commands.count == count, "相同context下编辑器身份更换也不能接收旧picker内容")
    }
}
