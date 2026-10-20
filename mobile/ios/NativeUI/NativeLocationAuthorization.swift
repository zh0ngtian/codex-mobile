import CoreLocation

/// 在明确选择位置时申请宿主权限；实际坐标仍由现有业务定位流程获取。
@MainActor final class NativeLocationAuthorization: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var requests: [UUID: CheckedContinuation<Bool, Never>] = [:]
    override init() {
        super.init()
        manager.delegate = self
    }
    func request() {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
    }
    func requestAuthorization() async -> Bool {
        let status = manager.authorizationStatus
        if status != .notDetermined { return status == .authorizedWhenInUse || status == .authorizedAlways }
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(returning: false); return }
                requests[id] = continuation
                request()
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(id, allowed: false) }
        }
    }
    func cancelPendingRequests() {
        let pending = Array(requests.values)
        requests.removeAll()
        for continuation in pending { continuation.resume(returning: false) }
    }
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in self?.authorizationChanged() }
    }
    private func authorizationChanged() {
        let status = manager.authorizationStatus
        guard status != .notDetermined else { return }
        let allowed = status == .authorizedWhenInUse || status == .authorizedAlways
        let pending = Array(requests.values)
        requests.removeAll()
        for continuation in pending { continuation.resume(returning: allowed) }
    }
    private func finish(_ id: UUID, allowed: Bool) { requests.removeValue(forKey: id)?.resume(returning: allowed) }
}
