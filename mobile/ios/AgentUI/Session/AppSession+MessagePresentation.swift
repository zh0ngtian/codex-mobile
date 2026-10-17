import Foundation

extension AppSession {
    func historyScrollAnchor(for messageID: UUID) -> String? { nativeMessage(messageID)?.scrollAnchorId }

    func historyScrollMessageID(in conversationID: UUID, previousID: UUID, anchorID: String?) -> UUID? {
        guard let messages = conversation(conversationID)?.messages else { return nil }
        if messages.contains(where: { $0.id == previousID }) { return previousID }
        guard let anchorID, !anchorID.isEmpty else { return nil }
        return messages.first {
            guard let native = nativeMessage($0.id) else { return false }
            return native.scrollAnchorId == anchorID || native.scrollAnchorIds?.contains(anchorID) == true
        }?.id
    }

    /// 只组装原型的展示归属；wire 快照与全部 raw 身份映射保持不变。
    func conversationMessages(_ values: [NativeMessage], running: Bool) -> (messages: [ChatMessage], liveCommentary: [ProgressEntry]) {
        let projected = values.map(message)
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
                messages.append(contentsOf: projected[index..<next])
                index = next
            }
        }
        let live = liveIndexes.map { index in
            let value = values[index]
            return progressEntry(NativeCommentaryEntry(id: value.id, text: value.text, timestamp: value.timestamp, blocks: value.blocks))
        }
        return (messages, live)
    }

    func progressEntry(_ entry: NativeCommentaryEntry) -> ProgressEntry {
        let timestamp = entry.timestamp.flatMap { time in
            time.isFinite && time > 0 ? Date(timeIntervalSince1970: time > 10_000_000_000 ? time / 1000 : time) : nil
        }
        let media = flatten(entry.blocks ?? []).filter { ["image", "video", "html", "source"].contains($0.kind) }.map(output)
        return ProgressEntry(id: scopedID("commentary", nativeSnapshot.contextId ?? "", entry.id), text: entry.text, createdAt: timestamp, outputs: media)
    }

    private func isAttachableHistory(_ value: NativeMessage) -> Bool {
        value.commentaryCanAttachToReply == true && value.role == "activity" && value.text.isEmpty && value.commentary?.isEmpty == false &&
        value.presentationBlocks.isEmpty && value.actions?.isEmpty != false && value.status?.isEmpty != false
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
