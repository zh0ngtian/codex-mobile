import Foundation

@main
struct NativePreferenceSmoke {
    static func main() throws {
        let suite = "CodexMobile.NativePreferenceTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        precondition(NativeUIPreference.accepts(kind: nil))
        precondition(NativeUIPreference.accepts(kind: "interface"))
        precondition(!NativeUIPreference.accepts(kind: "composer"), "旧输入框消息不能修改完整原生界面偏好")
        precondition(!NativeUIPreference.accepts(kind: true))
        let preference = NativeUIPreference(defaults: defaults)
        precondition(preference.enabled, "首次打开默认使用原生界面")
        let frozenLaunch = preference.enabled
        try preference.save(false)
        precondition(!preference.enabled)
        precondition(frozenLaunch, "保存偏好不应改变本次启动模式")
        precondition(!NativeUIPreference(defaults: defaults).enabled, "保留用户明确选择的网页界面")
        let broken = NativeUIPreference(defaults: defaults, synchronize: { false })
        do { try broken.save(true); preconditionFailure("存储失败必须报告错误") }
        catch { precondition(!preference.enabled, "保存失败必须保留原偏好") }
        try preference.save(true)
        precondition(preference.enabled)
        defaults.removeObject(forKey: NativeUIPreference.key)
        do { try broken.save(false); preconditionFailure("首次保存失败必须报告错误") }
        catch {
            precondition(defaults.object(forKey: NativeUIPreference.key) == nil, "失败后恢复首次默认状态")
            precondition(preference.enabled)
        }
        for legacyComposer in [true, false] {
            defaults.set(legacyComposer, forKey: "codexMobile.useNativeComposer")
            precondition(NativeUIPreference(defaults: defaults).enabled, "旧输入偏好不改变默认原生界面")
            try preference.save(false)
            precondition(!NativeUIPreference(defaults: defaults).enabled, "旧输入偏好不覆盖用户明确关闭原生界面的选择")
            defaults.removeObject(forKey: NativeUIPreference.key)
        }
        print("Preference smoke passed")
    }
}
