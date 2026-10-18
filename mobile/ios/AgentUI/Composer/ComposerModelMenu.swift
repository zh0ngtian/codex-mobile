import SwiftUI

struct ComposerModelMenu: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        let snapshot = session.nativeSnapshot
        let context = snapshot.contextId
        let currentModel = session.composer.configuration.model
        let efforts = snapshot.models.first(where: { $0.value == snapshot.modelValue })?.title == currentModel ? snapshot.efforts : []
        ComposerMenuContents(
            models: snapshot.models.map(ComposerMenuOption.init), efforts: efforts.map(ComposerMenuOption.init),
            context: context, title: currentModel,
            effortTitle: snapshot.efforts.first { $0.value == snapshot.effortValue }?.title ?? "",
            enabled: session.composerCanEdit && session.historyEdit == nil, english: preferences.isEnglish,
            chooseModel: { session.chooseMenuModel($0, context: context) },
            chooseEffort: { session.chooseMenuEffort($0, context: context) })
            .equatable()
    }
}

private struct ComposerMenuOption: Identifiable, Equatable {
    let id: String
    let title: String
    let value: String
    init(_ option: NativeOption) { id = option.id; title = option.title; value = option.value }
}

/// 快照中的消息、用量与命令回执更新不重建已展开的系统菜单，避免长列表滚动复位。
/// 选项、模型、上下文或语言变化仍正常更新；命令另有当前上下文及能力校验。
private struct ComposerMenuContents: View, Equatable {
    let models: [ComposerMenuOption]
    let efforts: [ComposerMenuOption]
    let context: String?
    let title: String
    let effortTitle: String
    let enabled: Bool
    let english: Bool
    let chooseModel: (String) -> Void
    let chooseEffort: (String) -> Void
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.models == rhs.models && lhs.efforts == rhs.efforts && lhs.context == rhs.context &&
        lhs.title == rhs.title && lhs.effortTitle == rhs.effortTitle && lhs.enabled == rhs.enabled && lhs.english == rhs.english
    }
    var body: some View {
        Menu {
            Section(english ? "Model" : "模型") {
                ForEach(models) { model in
                    Button(model.title) { chooseModel(model.value) }
                        .accessibilityIdentifier("model.option." + model.value)
                }
            }
            if !efforts.isEmpty {
                Section(english ? "Reasoning effort" : "思考强度") {
                    ForEach(efforts) { effort in
                        Button(effort.title) { chooseEffort(effort.value) }
                            .accessibilityIdentifier("effort.option." + effort.value)
                    }
                }
            }
        } label: {
            Text(title).font(.body).lineLimit(1)
                .foregroundStyle(AgentTheme.ink)
                .frame(minHeight: 44, alignment: .leading)
        }
        .menuIndicator(.hidden).menuOrder(.fixed).buttonStyle(.plain).tint(AgentTheme.ink)
        .disabled(!enabled)
        .accessibilityLabel(english ? "Model and reasoning" : "模型和思考强度")
        .accessibilityValue(title + ", " + effortTitle)
        .accessibilityIdentifier("composer.model")
    }
}
