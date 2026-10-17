import SwiftUI

struct ModelSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section(preferences.text("选择模型", "Choose a model")) {
                    ForEach(session.currentCapabilities.models, id: \.self) { model in
                        Button { choose(model) } label: {
                            HStack {
                                Text(model).font(.body)
                                Spacer()
                                if session.composer.configuration.model == model { Image(systemName: "checkmark").bold() }
                            }
                            .foregroundStyle(AgentTheme.ink).frame(minHeight: 44)
                        }
                    }
                }
            }
            .navigationTitle(preferences.text("模型", "Model"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(preferences.text("完成", "Done"), action: dismiss.callAsFunction) }
            }
        }
    }
    private func choose(_ model: String) { session.composer.configuration.model = model; session.configurationDidChange(); dismiss() }
}
