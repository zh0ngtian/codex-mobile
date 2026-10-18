import SwiftUI

struct ComposerEffortMenu: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        let snapshot = session.nativeSnapshot
        let context = snapshot.contextId
        let matchesModel = snapshot.models.first { $0.value == snapshot.modelValue }?.title == session.composer.configuration.model
        let efforts = matchesModel ? snapshot.efforts : []
        let title = efforts.first { $0.value == snapshot.effortValue }?.title ?? preferences.text("思考强度", "Reasoning")
        ComposerOptionMenu(options: efforts.map(ComposerMenuOption.init), context: context,
            title: title, section: preferences.text("思考强度", "Reasoning effort"),
            identifier: "composer.effort", optionPrefix: "effort.option.",
            enabled: session.composerCanEdit && session.historyEdit == nil && matchesModel,
            choose: { session.chooseMenuEffort($0, context: context) })
            .equatable()
    }
}
