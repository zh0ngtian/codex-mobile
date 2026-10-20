import Foundation

enum MessagePresentation {
    static func showsResponseActions(for message: ChatMessage) -> Bool {
        !message.isUser && message.kind != "activity" &&
        (!message.text.isEmpty || message.outputs.contains { $0.kind == .code && !$0.content.isEmpty })
    }
}
