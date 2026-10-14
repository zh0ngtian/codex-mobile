import Foundation
import Observation

@MainActor @Observable
final class NativeTimelineState {
    var visibleMessageID: String?
    var followsTail = true
    private(set) var pendingAnchorID: String?
    private(set) var revision = 0
    private var firstMessageID: String?

    func receive(messageIDs: [String]) {
        if let firstMessageID, firstMessageID != messageIDs.first, messageIDs.contains(firstMessageID),
           let visibleMessageID, messageIDs.contains(visibleMessageID) {
            pendingAnchorID = visibleMessageID
        }
        firstMessageID = messageIDs.first
        revision += 1
    }
    func didRestoreAnchor() { pendingAnchorID = nil }
}
