import SwiftUI

/// 普通菜单按钮不附加选择勾；档位始终以当前模型的权威快照为准。
struct ComposerModelMenu: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        let snapshot = session.nativeSnapshot
        Menu {
            Section(preferences.text("模型", "Model")) {
                ForEach(snapshot.models) { model in
                    Button(model.title) { session.chooseMenuModel(model.value, context: snapshot.contextId) }
                        .accessibilityIdentifier("model.option." + model.value)
                }
            }
            if !snapshot.efforts.isEmpty, snapshot.models.first(where: { $0.value == snapshot.modelValue })?.title == session.composer.configuration.model {
                Section(preferences.text("思考强度", "Reasoning effort")) {
                    ForEach(snapshot.efforts) { effort in
                        Button(effort.title) { session.chooseMenuEffort(effort.value, context: snapshot.contextId) }
                            .accessibilityIdentifier("effort.option." + effort.value)
                    }
                }
            }
        } label: {
            Text(session.composer.configuration.model)
                .font(.body).lineLimit(1)
                .foregroundStyle(.secondary)
                .frame(minHeight: 44, alignment: .leading)
        }
        .menuIndicator(.hidden)
        .menuOrder(.fixed)
        .buttonStyle(.plain)
        .tint(AgentTheme.ink)
        .disabled(!session.composerCanEdit || session.historyEdit != nil)
        .accessibilityLabel(preferences.text("模型和思考强度", "Model and reasoning"))
        .accessibilityValue(session.composer.configuration.model + ", " + (snapshot.efforts.first { $0.value == snapshot.effortValue }?.title ?? ""))
        .accessibilityIdentifier("composer.model")
    }
}
