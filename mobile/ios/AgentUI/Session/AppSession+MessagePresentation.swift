import Foundation

extension AppSession {
    func referenceMessageID(_ reference: NativeMessageReference) -> UUID? {
        guard let source = reference.source, let native = nativeSnapshot.messages.first(where: { $0.itemId == source.messageId }) else { return nil }
        let text = (native.rawText ?? native.text) as NSString
        guard source.startOffset >= 0, source.endOffset > source.startOffset, source.endOffset <= text.length,
              text.substring(with: NSRange(location: source.startOffset, length: source.endOffset - source.startOffset)) == reference.text else { return nil }
        return selectedConversation?.messages.first { rawMessageIDs[$0.id] == native.id }?.id
    }
    func revealReference(_ reference: NativeMessageReference) {
        guard let id = referenceMessageID(reference) else { return }
        referenceTarget = id; referenceRequestRevision += 1
    }

    func historyScrollAnchor(for messageID: UUID) -> String? { nativeMessage(messageID)?.scrollAnchorId }

    func historyScrollMessageID(in conversationID: UUID, previousID: UUID, anchorID: String?) -> UUID? {
        guard let messages = conversation(conversationID)?.messages else { return nil }
        if messages.contains(where: { $0.id == previousID }) { return previousID }
        let matchesAnchor: (NativeMessage) -> Bool = { value in
            guard let anchorID, !anchorID.isEmpty else { return false }
            return value.scrollAnchorId == anchorID || value.scrollAnchorIds?.contains(anchorID) == true
        }
        let source = nativeMessage(previousID) ?? nativeSnapshot.messages.first(where: matchesAnchor)
        let entryIDs = Set((source?.commentary ?? []).map { scopedID("commentary", nativeSnapshot.contextId ?? "", $0.id) })
        return messages.first {
            guard let native = nativeMessage($0.id) else { return false }
            return matchesAnchor(native) || $0.commentary.contains { entryIDs.contains($0.id) }
        }?.id
    }

    /// 只组装原型的展示归属；wire 快照与全部 raw 身份映射保持不变。
    func conversationMessages(_ values: [NativeMessage], running: Bool) -> (messages: [ChatMessage], liveCommentary: [ProgressEntry]) {
        let projected = values.map { value in
            var result = message(value)
            if isPreviousReplyHistory(value) {
                result.text = ""
                result.kind = "activity"
                result.duration = ""
                result.timestamp = ""
                result.outputs = []
            }
            return result
        }
        let liveIndexes = running ? values.indices.filter { isLiveCommentary(values[$0]) } : []
        let liveIndexSet = Set(liveIndexes)
        var messages: [ChatMessage] = []
        var index = 0
        while index < values.count {
            if values[index].hidesExecutionActivity { index += 1; continue }
            if liveIndexSet.contains(index) { index += 1; continue }
            guard isAttachableHistory(values[index]) else {
                messages.append(projected[index]); index += 1
                continue
            }
            var next = index
            var entries: [ProgressEntry] = []
            while next < values.count, !liveIndexSet.contains(next), isAttachableHistory(values[next]) {
                entries.append(contentsOf: projected[next].commentary)
                next += 1
            }
            if next < values.count, !liveIndexSet.contains(next), values[next].role == "assistant", values[next].phase != "commentary" {
                var reply = projected[next]
                reply.commentary = entries + reply.commentary
                messages.append(reply)
                index = next + 1
            } else {
                if (index..<next).contains(where: { isPreviousReplyHistory(values[$0]) }) {
                    var history = projected[index]
                    history.commentary = entries
                    messages.append(history)
                } else {
                    messages.append(contentsOf: projected[index..<next])
                }
                index = next
            }
        }
        let live = liveIndexes.map { index in
            let value = values[index]
            return progressEntry(NativeCommentaryEntry(id: value.id, text: value.text, timestamp: value.timestamp, blocks: value.blocks, quoteSource: value.quoteSource))
        }
        return (messages, live)
    }

    func progressEntry(_ entry: NativeCommentaryEntry) -> ProgressEntry {
        let timestamp = entry.timestamp.flatMap { time in
            time.isFinite && time > 0 ? Date(timeIntervalSince1970: time > 10_000_000_000 ? time / 1000 : time) : nil
        }
        let media = flatten(entry.blocks ?? []).filter { ["image", "video", "html", "source"].contains($0.kind) }.map(output)
        return ProgressEntry(id: scopedID("commentary", nativeSnapshot.contextId ?? "", entry.id), text: entry.text, createdAt: timestamp, outputs: media, quoteSource: entry.quoteSource, isPreviousReply: entry.isPreviousReply)
    }

    private func isAttachableHistory(_ value: NativeMessage) -> Bool {
        if isPreviousReplyHistory(value) { return true }
        return value.commentaryCanAttachToReply == true && value.role == "activity" && value.text.isEmpty && value.commentary?.isEmpty == false &&
        value.presentationBlocks.isEmpty && value.actions?.isEmpty != false && value.status?.isEmpty != false
    }

    private func isPreviousReplyHistory(_ value: NativeMessage) -> Bool {
        value.commentaryCanAttachToReply == true && value.role == "assistant" && value.phase != "commentary" &&
        value.commentary?.count == 1 && value.commentary?.first?.id == value.id && value.commentary?.first?.isPreviousReply == true
    }

    private func isLiveCommentary(_ value: NativeMessage) -> Bool {
        guard value.commentaryIsLiveTail == true, value.role == "assistant", value.phase == "commentary", value.status?.isEmpty != false,
              value.actions?.allSatisfy({ $0.command?.name == "message.copy" }) != false else { return false }
        return (value.blocks ?? []).allSatisfy { block in
            (["image", "video", "html", "source"].contains(block.kind) && block.command == nil && block.children?.isEmpty != false) ||
            (block.kind == "text" && block.id == value.id + ":timestamp" && block.command == nil)
        }
    }
}
