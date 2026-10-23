import SwiftUI

struct FirstMessageTimeline: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let submission: FirstMessageSubmission
    let flying: Bool
    var body: some View {
        ScrollView {
            VStack(alignment: .trailing, spacing: 22) {
                Color.clear.frame(height: 0)
                HStack(spacing: 8) {
                    Spacer(minLength: 30)
                    FirstMessageBubble(message: submission.message)
                        .background {
                            GeometryReader { geometry in
                                Color.clear.preference(key: FirstMessageDestinationKey.self, value: [submission.id: geometry.frame(in: .global)])
                            }
                        }
                        .opacity(flying ? 0 : 1)
                }
                status
                    .font(.body).foregroundStyle(.secondary).padding(.vertical, 12)
                    .opacity(flying ? 0 : 1)
                    .accessibilityIdentifier("first-message.status")
                if submission.state == .failed {
                    Button(preferences.text("返回编辑", "Return to editor")) { session.returnToFirstMessageEditor() }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("first-message.edit")
                }
                Color.clear.frame(height: 1).padding(.bottom, 14)
            }
            // 与正式时间线的状态区、消息间距和底部锚点保持相同几何，兼容超长首条内容。
            .padding(.horizontal, 16).padding(.top, 8)
        }
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("first-message.timeline")
    }

    @ViewBuilder private var status: some View {
        switch submission.state {
        case .waiting: Text(preferences.text("待发送", "Pending send"))
        case .unconfirmed: Text(preferences.text("发送结果待确认", "Awaiting send confirmation"))
        case .accepted: Text(preferences.text("已发送", "Sent"))
        case .failed: Text(preferences.runtimeText(submission.error ?? "消息未发送，输入已保留。"))
        }
    }
}

/// 与正式用户气泡采用相同字体、内容顺序、留白及圆角；无远程身份时不提供消息操作。
struct FirstMessageBubble: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.firstMessageImages) private var images
    let message: ChatMessage
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !message.references.isEmpty { MessageReferenceCards(references: message.references) }
            if !message.text.isEmpty {
                NativeSelectableText(text: NativeSelectableMarkdown.inline(message.text, color: UIColor(preferences.accent.userMessageText(in: colorScheme))), identifier: "first-message.text", openLink: { _ in }, fitsContentWidth: true)
                    .allowsHitTesting(false)
            }
            ForEach(Array(message.attachments.enumerated()), id: \.element.id) { index, attachment in
                if let output = AttachmentPreviewMapper.output(for: attachment) {
                    if output.kind == .image {
                        OutputImageCard(item: output, previewImage: images.indices.contains(index) ? images[index] : nil)
                            .allowsHitTesting(false)
                    } else { OutputCards(items: [output], isAttachment: true).allowsHitTesting(false) }
                } else {
                    OutputCardLabel(item: OutputItem(name: attachment.name, kind: .binary), subtitle: preferences.text("文件附件", "File attachment"))
                        .background(AgentTheme.card, in: .rect(cornerRadius: 16))
                        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(AgentTheme.line) }
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(preferences.accent.userMessageBackground(in: colorScheme), in: .rect(cornerRadius: 23))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("first-message.bubble")
    }
}
