import Foundation

/// 启动模式由宿主冻结；这里只保存下次启动使用的值。
struct NativeUIPreference {
    static let key = "codexMobile.useNativeUI"
    static let composerKey = "codexMobile.useNativeComposer"
    private let storageKey: String
    private let defaultEnabled: Bool
    private let defaults: UserDefaults
    private let synchronize: () -> Bool

    init(defaults: UserDefaults = .standard, storageKey: String = Self.key, defaultEnabled: Bool = false, synchronize: (() -> Bool)? = nil) {
        self.defaults = defaults
        self.storageKey = storageKey
        self.defaultEnabled = defaultEnabled
        self.synchronize = synchronize ?? { defaults.synchronize() }
    }

    var enabled: Bool { defaults.object(forKey: storageKey) == nil ? defaultEnabled : defaults.bool(forKey: storageKey) }

    func save(_ enabled: Bool) throws {
        let previous = defaults.object(forKey: storageKey)
        defaults.set(enabled, forKey: storageKey)
        guard synchronize() else {
            if let previous { defaults.set(previous, forKey: storageKey) }
            else { defaults.removeObject(forKey: storageKey) }
            _ = defaults.synchronize()
            throw CocoaError(.fileWriteUnknown)
        }
    }
}
