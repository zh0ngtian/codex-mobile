import Foundation
import PhotosUI
import SwiftUI

struct ComposerAttachmentWork: Identifiable {
    enum Operation { case photos([PhotosPickerItem]), files([URL]), retry, location }
    let id = UUID()
    let selection: ComposerAttachmentSelection
    let operation: Operation
}
