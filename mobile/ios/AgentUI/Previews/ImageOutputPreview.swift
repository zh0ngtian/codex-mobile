import SwiftUI

struct ImageOutputPreview: View {
    @Environment(AppPreferences.self) private var preferences
    let image: UIImage
    let name: String
    @State private var zoom = 1.0
    @State private var gestureStartZoom = 1.0

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                let fit = min(geometry.size.width / image.size.width, geometry.size.height / image.size.height)
                ScrollView([.horizontal, .vertical]) {
                    Image(uiImage: image).renderingMode(.original)
                        .resizable().interpolation(.high)
                        .frame(width: image.size.width * fit * zoom, height: image.size.height * fit * zoom)
                        .frame(minWidth: geometry.size.width, minHeight: geometry.size.height)
                        .contentShape(.rect)
                        .onTapGesture(count: 2, perform: toggleZoom)
                        .simultaneousGesture(MagnifyGesture().onChanged(magnified).onEnded(magnificationEnded))
                        .accessibilityLabel(name)
                        .accessibilityHint(preferences.text("双击切换缩放；放大后拖动查看图片。", "Double tap to zoom; drag to pan when enlarged."))
                        .accessibilityAction(named: preferences.text("放大", "Zoom in"), zoomIn)
                        .accessibilityAction(named: preferences.text("缩小", "Zoom out"), zoomOut)
                }
                .background(Color.primary.opacity(0.035))
            }
            Divider()
            HStack(spacing: 12) {
                Button(preferences.text("缩小", "Zoom out"), systemImage: "minus.magnifyingglass", action: zoomOut)
                    .labelStyle(.iconOnly).frame(width: 44, height: 44).disabled(zoom <= 1)
                Text("\(Int((zoom * 100).rounded()))%")
                    .font(.body.monospacedDigit()).frame(minWidth: 58)
                    .accessibilityLabel(preferences.text("缩放 \(Int((zoom * 100).rounded()))%", "Zoom \(Int((zoom * 100).rounded()))%"))
                Button(preferences.text("放大", "Zoom in"), systemImage: "plus.magnifyingglass", action: zoomIn)
                    .labelStyle(.iconOnly).frame(width: 44, height: 44).disabled(zoom >= 4)
                Spacer()
                Button(preferences.text("还原", "Reset"), systemImage: "arrow.counterclockwise", action: reset)
                    .font(.body).frame(minHeight: 44)
            }
            .buttonStyle(.borderless).controlSize(.large).padding(.horizontal, 20).padding(.vertical, 12)
        }
    }

    private func zoomIn() { setZoom(zoom + 0.25) }
    private func zoomOut() { setZoom(zoom - 0.25) }
    private func reset() { setZoom(1) }
    private func toggleZoom() { setZoom(zoom == 1 ? 2 : 1) }
    private func setZoom(_ value: Double) { zoom = min(4, max(1, value)); gestureStartZoom = zoom }
    private func magnified(_ value: MagnifyGesture.Value) { zoom = min(4, max(1, gestureStartZoom * value.magnification)) }
    private func magnificationEnded(_ value: MagnifyGesture.Value) { setZoom((zoom * 4).rounded() / 4) }
}
