import Foundation

/// 单一位移驱动抽屉与主表面；不会在手势中向业务层反复写开关。
enum SidebarPresentation {
    static func width(in containerWidth: Double) -> Double {
        containerWidth.isFinite ? max(0, containerWidth * 0.8) : 0
    }
    static func accepts(startX: Double, dx: Double, dy: Double, isOpen: Bool) -> Bool {
        guard startX.isFinite, startX >= 0, dx.isFinite, dy.isFinite,
              abs(dx) >= 12, abs(dx) > abs(dy) * 1.3 else { return false }
        return isOpen ? dx < 0 : (startX <= 44 && dx > 0)
    }
    static func offset(isOpen: Bool, translation: Double, containerWidth: Double) -> Double {
        let limit = width(in: containerWidth)
        let delta = translation.isFinite ? translation : 0
        return min(limit, max(0, (isOpen ? limit : 0) + delta))
    }
    static func targetIsOpen(isOpen: Bool, predictedTranslation: Double, containerWidth: Double) -> Bool {
        let limit = width(in: containerWidth)
        guard limit > 0 else { return false }
        return offset(isOpen: isOpen, translation: predictedTranslation, containerWidth: containerWidth) > limit / 2
    }
}
