import Foundation

enum PreviewLoadError: Error {
    case missingResource, invalidImage, invalidVideo, unsupportedEncoding
}
