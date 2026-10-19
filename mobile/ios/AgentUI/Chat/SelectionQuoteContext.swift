import SwiftUI
import UIKit

private struct SelectionQuoteSourceModifier: ViewModifier {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    let source: NativeQuoteSource?
    let region: String?
    func body(content: Content) -> some View {
        let contextID = session.nativeSnapshot.contextId
        var source = source
        if let region { source?.region = region }
        let canAdd = session.composerCanEdit && !session.nativeSnapshot.readOnly && session.historyEdit == nil
        let canSide = session.nativeSnapshot.sidechatActive != true
        let english = preferences.isEnglish
        return content.environment(\.nativeSelectionActions, source.flatMap { source in
            guard let contextID else { return nil }
            return { renderedText, range in
                guard let params = NativeQuoteSelection(source: source, renderedText: renderedText, range: range).params(contextID: contextID) else { return [] }
                var actions: [UIMenuElement] = []
                if canAdd { actions.append(UIAction(title: english ? "Add to chat" : "加入聊天", image: UIImage(systemName: "text.badge.plus")) { _ in session.nativeStore?.command("message.quote", params) }) }
                if canSide { actions.append(UIAction(title: english ? "Ask in side chat" : "在 Sidechat 中提问", image: UIImage(systemName: "bubble.left.and.bubble.right")) { _ in session.nativeStore?.command("sidechat.quote", params) }) }
                return actions
            }
        })
    }
}
extension View {
    func selectionQuoteSource(_ source: NativeQuoteSource?, region: String? = nil) -> some View { modifier(SelectionQuoteSourceModifier(source: source, region: region)) }
}
