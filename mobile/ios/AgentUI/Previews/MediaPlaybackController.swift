import AVFoundation
import Foundation
import Observation

@MainActor @Observable
final class MediaPlaybackController {
    let player: AVPlayer
    private(set) var timeControlStatus: AVPlayer.TimeControlStatus
    @ObservationIgnored private var statusObservation: NSKeyValueObservation?

    init(url: URL) {
        player = AVPlayer(url: url)
        timeControlStatus = player.timeControlStatus
        statusObservation = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in self?.refreshStatus() }
        }
    }

    var isPaused: Bool { timeControlStatus == .paused }
    var isWaiting: Bool { timeControlStatus == .waitingToPlayAtSpecifiedRate }

    func togglePlayback() {
        if player.timeControlStatus == .paused {
            let position = player.currentTime().seconds
            let duration = player.currentItem?.duration.seconds ?? .nan
            if position.isFinite, duration.isFinite, duration > 0, position >= duration {
                player.seek(to: .zero)
            }
            player.play()
        } else {
            player.pause()
        }
    }

    func pause() { player.pause() }
    private func refreshStatus() { timeControlStatus = player.timeControlStatus }
}
