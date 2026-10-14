import SwiftUI

struct NativeScaledFont: ViewModifier {
    let scale: Double
    let weight: Font.Weight
    @ScaledMetric private var size: Double
    init(size: Double, scale: Double, weight: Font.Weight = .regular, relativeTo: Font.TextStyle = .body) {
        self.scale = scale; self.weight = weight
        _size = ScaledMetric(wrappedValue: size, relativeTo: relativeTo)
    }
    func body(content: Content) -> some View { content.font(.system(size: size * scale, weight: weight)) }
}
