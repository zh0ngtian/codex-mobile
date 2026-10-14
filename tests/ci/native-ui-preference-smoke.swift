import Foundation

@main
struct NativePreferenceSmoke {
    static func main() throws {
        let suite = "CodexMobile.NativePreferenceTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let preference = NativeUIPreference(defaults: defaults)
        precondition(!preference.enabled, "首次打开默认使用旧界面")
        let frozenLaunch = preference.enabled
        try preference.save(true)
        precondition(preference.enabled)
        precondition(!frozenLaunch, "保存偏好不应改变本次启动模式")
        precondition(NativeUIPreference(defaults: defaults).enabled, "下次完整启动应读到已保存值")
        let broken = NativeUIPreference(defaults: defaults, synchronize: { false })
        do { try broken.save(false); preconditionFailure("存储失败必须报告错误") }
        catch { precondition(preference.enabled, "保存失败必须保留原偏好") }
        try preference.save(false)
        precondition(!preference.enabled)
        defaults.removeObject(forKey: NativeUIPreference.key)
        do { try broken.save(true); preconditionFailure("首次保存失败必须报告错误") }
        catch { precondition(defaults.object(forKey: NativeUIPreference.key) == nil, "失败后恢复首次默认状态") }
        print("Preference smoke passed")
    }
}
