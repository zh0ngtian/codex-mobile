import Foundation

enum SubmissionResult: Equatable, Sendable { case ignored, started(UUID), queued(UUID), recovery(UUID) }
