import Foundation

/// 到顶只准备下一次手势；只有之后独立的向下拉动可以消费一次历史请求。
struct HistoryPullState: Equatable {
    private(set) var isArmed = false
    private var dragging = false
    private var settling = false
    private var eligibleDrag = false
    private var requestedDuringDrag = false
    private var visitedTop = false
    private let topTolerance: Double = 2
    private let pullThreshold: Double = 56

    mutating func dragBegan(at offset: Double) {
        guard !dragging, offset.isFinite else { return }
        if settling { settled(at: offset) }
        dragging = true
        settling = false
        eligibleDrag = isArmed && offset <= topTolerance
        requestedDuringDrag = false
        visitedTop = offset <= topTolerance
    }

    mutating func positionChanged(to offset: Double, canLoad: Bool, isLoading: Bool) -> Bool {
        guard offset.isFinite else { return false }
        if offset > topTolerance {
            isArmed = false
            eligibleDrag = false
        } else if dragging {
            visitedTop = true
        } else if settling, !isLoading {
            isArmed = true
        }
        guard canLoad, !isLoading else { eligibleDrag = false; return false }
        guard dragging, eligibleDrag, !requestedDuringDrag, offset <= -pullThreshold else { return false }
        requestedDuringDrag = true
        eligibleDrag = false
        isArmed = false
        return true
    }

    mutating func dragEnded(at offset: Double, willDecelerate: Bool) {
        guard dragging else { return }
        if !requestedDuringDrag { isArmed = visitedTop && offset <= topTolerance }
        dragging = false
        eligibleDrag = false
        settling = willDecelerate
    }

    mutating func settled(at offset: Double) {
        guard dragging || settling else { return }
        if !requestedDuringDrag { isArmed = offset.isFinite && offset <= topTolerance }
        dragging = false
        settling = false
        eligibleDrag = false
        visitedTop = false
    }

    mutating func loadingFinished(at offset: Double) {
        isArmed = offset.isFinite && offset <= topTolerance
    }

    mutating func programmaticScrollBegan() { self = Self() }
    mutating func reset() { self = Self() }
}
