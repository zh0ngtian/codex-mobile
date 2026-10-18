import Foundation

extension AppSession {
    func chooseMenuModel(_ value: String, context: String?) {
        guard composerCanEdit, historyEdit == nil, !sidebarVisible, context == nativeSnapshot.contextId,
              let model = nativeSnapshot.models.first(where: { $0.value == value }) else { return }
        composer.configuration.model = model.title
        nativeStore?.chooseComposerOption("model.select", value: value, contextID: context)
    }
    func chooseMenuEffort(_ value: String, context: String?) {
        guard composerCanEdit, historyEdit == nil, !sidebarVisible, context == nativeSnapshot.contextId,
              nativeSnapshot.models.first(where: { $0.value == nativeSnapshot.modelValue })?.title == composer.configuration.model,
              let index = nativeSnapshot.efforts.firstIndex(where: { $0.value == value }) else { return }
        composer.configuration.reasoning = Double(index)
        nativeStore?.chooseComposerOption("effort.select", value: value, contextID: context)
    }
    func toggleMenuFast(context: String?) {
        guard composerCanEdit, historyEdit == nil, !sidebarVisible, currentCapabilities.supportsFast,
              context == nativeSnapshot.contextId,
              nativeSnapshot.models.first(where: { $0.value == nativeSnapshot.modelValue })?.title == composer.configuration.model else { return }
        let next: RunSpeed = composer.configuration.speed == .normal ? .fast : .normal
        guard let option = nativeSnapshot.speeds?.first(where: {
            (["fast", "priority"].contains($0.value)) == (next == .fast)
        }) else { return }
        composer.configuration.speed = next
        // 每次点击都提交意图，不能用尚未回填的快照跳过快速反向切换。
        nativeStore?.chooseComposerOption("speed.select", value: option.value, contextID: context)
    }
}
