import SwiftUI

struct NativeZoomableImage: View {
    let image: UIImage
    let title: String
    @State private var zoom: Double = 1
    @GestureState private var gestureZoom: Double = 1
    var body: some View {
        GeometryReader { geometry in
            let fit = min(geometry.size.width / image.size.width, geometry.size.height / image.size.height)
            let scale = min(6, max(1, zoom * gestureZoom))
            ScrollView([.horizontal, .vertical]) {
                Image(uiImage: image).resizable()
                    .frame(width: image.size.width * fit * scale, height: image.size.height * fit * scale)
                    .frame(minWidth: geometry.size.width, minHeight: geometry.size.height)
                    .accessibilityLabel(title)
            }
            .defaultScrollAnchor(.center)
            .gesture(MagnifyGesture()
                .updating($gestureZoom) { value, state, _ in state = value.magnification }
                .onEnded { value in zoom = min(6, max(1, zoom * value.magnification)) })
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: zoom = min(6, zoom + 0.5)
                case .decrement: zoom = max(1, zoom - 0.5)
                @unknown default: break
                }
            }
        }
    }
}
