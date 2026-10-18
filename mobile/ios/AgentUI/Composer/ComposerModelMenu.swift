import SwiftUI

struct ComposerModelMenu: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        let snapshot = session.nativeSnapshot
        let context = snapshot.contextId
        ComposerOptionMenu(options: snapshot.models.map(ComposerMenuOption.init), context: context,
            title: session.composer.configuration.model, section: preferences.text("模型", "Model"),
            identifier: "composer.model", optionPrefix: "model.option.",
            enabled: session.composerCanEdit && session.historyEdit == nil,
            choose: { session.chooseMenuModel($0, context: context) })
            .equatable()
    }
}

struct ComposerMenuOption: Identifiable, Equatable {
    let id: String
    let title: String
    let value: String
    init(_ option: NativeOption) { id = option.id; title = option.title; value = option.value }
}

/// 只由选项、当前值及作用域驱动，消息、用量和回执更新不重建展开中的菜单。
struct ComposerOptionMenu: View, Equatable {
    let options: [ComposerMenuOption]
    let context: String?
    let title: String
    let section: String
    let identifier: String
    let optionPrefix: String
    let enabled: Bool
    let choose: (String) -> Void
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.options == rhs.options && lhs.context == rhs.context && lhs.title == rhs.title &&
        lhs.section == rhs.section && lhs.identifier == rhs.identifier && lhs.optionPrefix == rhs.optionPrefix && lhs.enabled == rhs.enabled
    }
    var body: some View {
        Menu {
            Section(section) {
                ForEach(options) { option in
                    Button(option.title) { choose(option.value) }
                        .accessibilityIdentifier(optionPrefix + option.value)
                }
            }
        } label: {
            Text(title).font(.body).lineLimit(1).foregroundStyle(AgentTheme.ink)
                .frame(minHeight: 44, alignment: .leading)
        }
        .menuIndicator(.hidden).menuOrder(.fixed).buttonStyle(.plain).tint(AgentTheme.ink)
        .disabled(!enabled || options.isEmpty)
        .accessibilityLabel(section).accessibilityValue(title).accessibilityIdentifier(identifier)
    }
}
