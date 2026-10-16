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
        let composer = NativeUIPreference(defaults: defaults, storageKey: NativeUIPreference.composerKey, defaultEnabled: true)
        precondition(composer.enabled, "首次打开默认使用独立原生输入框")
        let frozenComposer = composer.enabled
        try composer.save(false)
        precondition(!composer.enabled && frozenComposer, "保存输入偏好不改变冻结值")
        precondition(!preference.enabled, "两个偏好相互独立")
        let brokenComposer = NativeUIPreference(defaults: defaults, storageKey: NativeUIPreference.composerKey, defaultEnabled: true, synchronize: { false })
        do { try brokenComposer.save(true); preconditionFailure("输入偏好失败必须报告") }
        catch { precondition(!composer.enabled, "输入偏好失败回滚") }
        print("Preference smoke passed")
    }
}
