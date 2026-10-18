import CoreLocation

/// 在明确选择位置时申请宿主权限；实际坐标仍由现有业务定位流程获取。
@MainActor final class NativeLocationAuthorization: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    override init() {
        super.init()
        manager.delegate = self
    }
    func request() {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
    }
}
