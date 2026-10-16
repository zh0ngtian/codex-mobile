import Foundation

@main
struct NativeUIDecodeFixture {
    static func main() throws {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        let snapshot = try JSONDecoder().decode(NativeSnapshot.self, from: data)
        precondition(snapshot.ready)
        precondition(snapshot.conversationActions?.first?.command?.name == "settings.open")
        print("Native bootstrap snapshot decoded")
    }
}
