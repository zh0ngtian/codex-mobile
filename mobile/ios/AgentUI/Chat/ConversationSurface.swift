import SwiftUI

/// 输入栏跨“新建 → 待发送 → 已确认”保持同一个宿主，键盘仅跟随系统时序。
struct ConversationSurface: View {
    @Environment(AppSession.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var capture = FirstMessageFlightCapture()
    @State private var flightID: UUID?
    @State private var sourceImage: UIImage?
    @State private var sourceFrame = CGRect.zero
    @State private var destination = CGRect.zero
    @State private var destinationID: UUID?
    @State private var progress: CGFloat = 0
    @State private var started = false
    @State private var images: [UIImage?] = []

    var body: some View {
        ZStack(alignment: .top) {
            if let first = session.firstMessageSubmission {
                FirstMessageTimeline(submission: first, flying: !first.animationFinished)
                NewTaskTargets()
                    .padding(.horizontal, 20).padding(.top, 10)
                    .opacity(started || reduceMotion ? 0 : 1)
                    .offset(y: started && !reduceMotion ? -6 : 0)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: started)
                    .allowsHitTesting(false).accessibilityHidden(true)
            } else if let id = session.selectedConversationID {
                ConversationScreen(conversationID: id).id(id).transition(.identity)
            } else {
                NewConversationScreen().transition(.identity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AgentTheme.page)
        .modifier(ConversationHeader(conversationID: session.selectedConversationID))
        .modifier(ConversationComposerInset(conversationID: session.selectedConversationID))
        .environment(\.firstMessageCapture, capture)
        .environment(\.firstMessageImages, images)
        .overlay { flightOverlay }
        .onPreferenceChange(FirstMessageDestinationKey.self) { frames in
            guard let id = session.firstMessageSubmission?.id, let frame = frames[id] else { return }
            guard frame.width > 0, frame.height > 0 else { return }
            destination = frame; destinationID = id
            startFlight()
        }
        .onChange(of: session.firstMessageSubmission?.id) { _, id in
            guard let id else { flightID = nil; sourceImage = nil; capture.image = nil; return }
            flightID = id; sourceImage = capture.image; sourceFrame = capture.sourceFrame
            images = capture.submittedImages
            progress = 0; started = false
            startFlight()
        }
        .onChange(of: session.nativeSnapshot.contextId) {
            flightID = nil; sourceImage = nil; images = []; capture.thumbnails = [:]; capture.image = nil
        }
    }

    @ViewBuilder private var flightOverlay: some View {
        if let id = flightID, let first = session.firstMessageSubmission, first.id == id, let image = sourceImage, !reduceMotion, destinationID == id {
            GeometryReader { geometry in
                let origin = geometry.frame(in: .global).origin
                FirstMessageFlight(image: image, message: first.message, source: sourceFrame, destination: destination,
                    origin: origin, progress: progress)
            }
            .clipped()
            .allowsHitTesting(false).accessibilityHidden(true)
        }
    }

    private func startFlight() {
        guard let id = flightID, !started else { return }
        if reduceMotion || sourceImage == nil {
            started = true; flightID = nil; sourceImage = nil; capture.image = nil
            session.firstMessageAnimationFinished(id)
            return
        }
        guard destinationID == id, destination.width > 0, destination.height > 0 else { return }
        started = true
        withAnimation(.timingCurve(0.2, 0.78, 0.2, 1, duration: 0.36), completionCriteria: .removed) {
            progress = 1
        } completion: {
            guard flightID == id else { return }
            flightID = nil; sourceImage = nil; capture.image = nil
            session.firstMessageAnimationFinished(id)
        }
    }
}

/// 逐帧计算交接透明度，短文字共用首字位置；附件组保持各自真实布局和字号。
private struct FirstMessageFlight: View, Animatable {
    let image: UIImage
    let message: ChatMessage
    let source: CGRect
    let destination: CGRect
    let origin: CGPoint
    var progress: CGFloat
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }
    var body: some View {
        let textOnly = message.attachments.isEmpty && message.references.isEmpty
        let sourceEnd = textOnly ? CGPoint(x: destination.minX + 16, y: destination.minY + 10) : destination.origin
        let targetStart = textOnly ? CGPoint(x: source.minX - 16, y: source.minY - 10) : source.origin
        ZStack(alignment: .topLeading) {
            Image(uiImage: image).resizable().frame(width: source.width, height: source.height)
                .opacity(max(0, 1 - progress * 4))
                .position(x: interpolate(source.minX, sourceEnd.x) + source.width / 2 - origin.x,
                          y: interpolate(source.minY, sourceEnd.y) + source.height / 2 - origin.y)
            FirstMessageBubble(message: message)
                .frame(width: destination.width, height: destination.height, alignment: .top)
                .opacity(min(1, max(0, (progress - 0.12) / 0.62)))
                .position(x: interpolate(targetStart.x, destination.minX) + destination.width / 2 - origin.x,
                          y: interpolate(targetStart.y, destination.minY) + destination.height / 2 - origin.y)
        }
    }
    private func interpolate(_ start: CGFloat, _ end: CGFloat) -> CGFloat { start + (end - start) * progress }
}
