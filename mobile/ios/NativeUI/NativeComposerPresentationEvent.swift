import Foundation

struct NativeComposerPresentationEvent: Identifiable, Equatable {
    let id: String
    let contextID: String
    let presentation: NativeComposerPresentation
}
