import SwiftUI
import UIKit

/// 只截取输入内容到内存，随首条转场释放；不截图键盘、工具栏，不写入磁盘。
@MainActor final class FirstMessageFlightCapture {
    weak var sourceView: UIView?
    var image: UIImage?
    var sourceFrame = CGRect.zero
    var thumbnails: [UUID: UIImage] = [:]
    var submittedImages: [UIImage?] = []

    func prepare(draft: ComposerDraft, quoted: Bool) {
        image = nil
        submittedImages = draft.attachments.map { thumbnails[$0.id] }
        guard let sourceView, let window = sourceView.window else { return }
        var rect = sourceView.convert(sourceView.bounds, to: window)
        if draft.attachments.isEmpty, !quoted {
            let font = UIFont.preferredFont(forTextStyle: .body)
            let bounds = (draft.text as NSString).boundingRect(with: CGSize(width: max(1, rect.width - 8), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil)
            rect.origin.x += 4
            rect.size.width = min(rect.width - 8, ceil(bounds.width) + 2)
            rect.size.height = min(rect.height, max(font.lineHeight, ceil(bounds.height)))
        }
        guard rect.width > 0, rect.height > 0 else { return }
        sourceFrame = window.convert(rect, to: nil)
        image = UIGraphicsImageRenderer(size: rect.size).image { renderer in
            renderer.cgContext.translateBy(x: -rect.minX, y: -rect.minY)
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
        }
    }
}

private struct FirstMessageCaptureKey: EnvironmentKey {
    static let defaultValue: FirstMessageFlightCapture? = nil
}
private struct FirstMessageImagesKey: EnvironmentKey {
    static let defaultValue: [UIImage?] = []
}
extension EnvironmentValues {
    var firstMessageCapture: FirstMessageFlightCapture? {
        get { self[FirstMessageCaptureKey.self] }
        set { self[FirstMessageCaptureKey.self] = newValue }
    }
    var firstMessageImages: [UIImage?] {
        get { self[FirstMessageImagesKey.self] }
        set { self[FirstMessageImagesKey.self] = newValue }
    }
}

struct FirstMessageCaptureMarker: UIViewRepresentable {
    let capture: FirstMessageFlightCapture?
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        capture?.sourceView = view
        return view
    }
    func updateUIView(_ view: UIView, context: Context) { capture?.sourceView = view }
}

struct FirstMessageDestinationKey: PreferenceKey {
    static var defaultValue: [UUID: CGRect] = [:]
    static func reduce(value: inout [UUID: CGRect], nextValue: () -> [UUID: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}
