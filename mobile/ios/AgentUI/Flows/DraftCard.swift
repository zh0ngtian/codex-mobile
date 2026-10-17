import SwiftUI

struct DraftCard: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.dismiss) private var dismiss
    @State private var restoreError: String?
    @State private var restoring = false
    let draft: DraftRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(summary)
                .font(.body.weight(.medium))
                .lineLimit(4)
                .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 7) {
                Label(deviceName, systemImage: deviceMissing ? "desktopcomputer.trianglebadge.exclamationmark" : "desktopcomputer")
                    .foregroundStyle(deviceMissing ? Color.orange : Color.secondary)
                Label(draft.composition.project ?? preferences.text("无项目", "No project"), systemImage: "folder")
                    .foregroundStyle(.secondary)
                Label {
                    Text(draft.updatedAt, format: .dateTime.month().day().hour().minute())
                } icon: {
                    Image(systemName: "clock")
                }
                .foregroundStyle(.secondary)
            }
            .font(.caption)
            FlowAttachmentSummary(attachments: draft.composition.attachments)
            if let restoreError {
                FlowErrorBanner(message: restoreError)
            }
            HStack(spacing: 12) {
                Button(preferences.text("恢复草稿", "Restore draft"), systemImage: "arrow.uturn.backward", action: restore)
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                    .disabled(restoring)
                Spacer(minLength: 0)
                Button(preferences.text("删除草稿", "Delete draft"), systemImage: "trash", role: .destructive, action: delete)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.bordered)
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(16)
        .background(AgentTheme.card, in: RoundedRectangle(cornerRadius: 20))
    }

    private var summary: String {
        let text = draft.composition.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? preferences.text("仅附件草稿", "Attachments only") : text
    }

    private var deviceMissing: Bool {
        guard let id = draft.composition.deviceID else { return true }
        return session.device(id) == nil
    }

    private var deviceName: String {
        guard let id = draft.composition.deviceID, let device = session.device(id) else {
            return preferences.text("原设备不可用", "Original device unavailable")
        }
        return device.name
    }

    private func restore() {
        guard !restoring else { return }
        restoring = true
        Task {
            let restored = await session.restoreDraftAndWait(draft.id)
            restoring = false
            if restored {
                restoreError = nil
                dismiss()
            } else {
                let error = deviceMissing
                    ? preferences.text("无法恢复：原设备已移除。草稿仍保留在此处。", "Cannot restore: the original device was removed. The draft is still saved.")
                    : preferences.text("暂时无法恢复草稿，请重试。", "The draft could not be restored. Try again.")
                restoreError = error
                session.toast = error
            }
        }
    }

    private func delete() { session.deleteDraft(draft.id) }
}
