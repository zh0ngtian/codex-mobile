import Foundation

@main
struct NativeUIDecodeFixture {
    static func main() throws {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        if CommandLine.arguments.contains("--navigation") {
            let snapshots = try JSONDecoder().decode([NativeSnapshot].self, from: data)
            precondition(snapshots.first?.navigationLoading == true && snapshots.last?.navigationLoading == false)
            let original = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
            let roundTrip = try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshots)) as! [[String: Any]]
            for (before, after) in zip(original, roundTrip) {
                precondition(before["navigationLoading"] as? Bool == after["navigationLoading"] as? Bool, "真实App导航状态须经生产Swift DTO无损保留")
            }
            print("Native navigation snapshots decoded")
            return
        }
        let snapshot = try JSONDecoder().decode(NativeSnapshot.self, from: data)
        precondition(snapshot.ready)
        precondition(snapshot.conversationActions?.first?.command?.name == "settings.open")
        print("Native bootstrap snapshot decoded")
    }
}
