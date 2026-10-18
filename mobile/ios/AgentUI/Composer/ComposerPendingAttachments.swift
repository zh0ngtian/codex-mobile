import SwiftUI

struct ComposerPendingAttachments: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(AppSession.self) private var session
    let flow: ComposerAttachmentFlow
    let retry: () -> Void
    let clear: () -> Void

    var body: some View {
        if !flow.items.isEmpty || flow.error != nil || flow.isLocating {
            VStack(alignment: .leading, spacing: 6) {
                if !flow.items.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(flow.items) { item in
                                ComposerAttachmentCard(item: item, preview: {
                                    if let output = AttachmentPreviewMapper.output(for: item) { session.previewItem = output }
                                    else if let error = item.error { session.toast = error }
                                }, remove: { flow.remove(item.id) })
                                .disabled(flow.isCommitting)
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                }
                if flow.isCommitting || flow.isLocating {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text(flow.isLocating ? preferences.text("正在获取当前位置…", "Getting your location…") : preferences.text("正在添加附件…", "Adding attachments…"))
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                if let error = flow.error {
                    Text(error).font(.caption).foregroundStyle(.red)
                        .accessibilityIdentifier("composer.attachments.error")
                }
                HStack(spacing: 16) {
                    if flow.canRetry {
                        Button(preferences.text("重试添加", "Retry adding"), action: retry)
                            .disabled(!session.composerCanEdit || session.historyEdit != nil)
                            .accessibilityIdentifier("composer.attachments.retry")
                    }
                    if !flow.isCommitting && !flow.isLocating {
                        Button(flow.items.isEmpty ? preferences.text("关闭", "Close") : preferences.text("移除全部", "Remove all"), action: clear)
                            .accessibilityIdentifier("composer.attachments.clear")
                    }
                }
                .font(.caption).buttonStyle(.borderless).tint(AgentTheme.ink)
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
        }
    }
}
