import Foundation

/// 启动模式由宿主冻结；这里只保存下次启动使用的值。
struct NativeUIPreference {
    static let key = "codexMobile.useNativeUI"
    static func accepts(kind: Any?) -> Bool { kind == nil || kind as? String == "interface" }
    private let defaults: UserDefaults
    private let synchronize: () -> Bool

    init(defaults: UserDefaults = .standard, synchronize: (() -> Bool)? = nil) {
        self.defaults = defaults
        self.synchronize = synchronize ?? { defaults.synchronize() }
    }

    var enabled: Bool { defaults.object(forKey: Self.key) == nil ? true : defaults.bool(forKey: Self.key) }

    func save(_ enabled: Bool) throws {
        let previous = defaults.object(forKey: Self.key)
        defaults.set(enabled, forKey: Self.key)
        guard synchronize() else {
            if let previous { defaults.set(previous, forKey: Self.key) }
            else { defaults.removeObject(forKey: Self.key) }
            _ = defaults.synchronize()
            throw CocoaError(.fileWriteUnknown)
        }
    }
}
