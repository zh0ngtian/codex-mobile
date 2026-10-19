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
    @Environment(AppPreferences.self) private var preferences
    let options: [ComposerMenuOption]
    let context: String?
    let title: String
    let section: String
    let identifier: String
    let optionPrefix: String
    let enabled: Bool
    var effortProgress: Double? = nil
    let choose: (String) -> Void
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.effortProgress == rhs.effortProgress && lhs.options == rhs.options && lhs.context == rhs.context && lhs.title == rhs.title &&
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
            HStack(spacing: 5) {
                if identifier == "composer.model", title.localizedCaseInsensitiveContains("gpt") {
                    Image("ModelProviderOpenAI").resizable().scaledToFit().frame(width: 16, height: 16)
                }
                if identifier == "composer.effort" {
                    ZStack {
                        ComposerEffortArc(fraction: 1).stroke(.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        ComposerEffortArc(fraction: effortProgress ?? 0).stroke(preferences.accent.color, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    }
                    .frame(width: 16, height: 11)
                    .accessibilityHidden(true)
                }
                Text(title).lineLimit(1).minimumScaleFactor(0.9).truncationMode(.middle)
            }
            .font(.footnote).foregroundStyle(AgentTheme.ink)
            .modifier(ComposerControlSurface())
        }
        .menuIndicator(.hidden).menuOrder(.fixed).buttonStyle(.plain).tint(AgentTheme.ink)
        .disabled(!enabled || options.isEmpty)
        .accessibilityLabel(section).accessibilityValue(title).accessibilityIdentifier(identifier)
    }
}
