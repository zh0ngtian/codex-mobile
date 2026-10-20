import Foundation

@main
struct AgentUIProjectionDecode {
    static func main() throws {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        let snapshot = try JSONDecoder().decode(NativeSnapshot.self, from: data)
        precondition(snapshot.backends.first?.gatewayAddress == "https://gateway.invalid")
        precondition(snapshot.backends.first?.enabled == false)
        precondition(snapshot.backends.first?.projects == ["/项目"])
        precondition(snapshot.groups.first?.backendId == "b")
        precondition(snapshot.groups.first?.allItems?.first?.threadId == "t")
        precondition(snapshot.groups.first?.allItems?.first?.isPinned == true)
        precondition(snapshot.queued.first?.queueState == "uncertain")
        precondition(snapshot.queued.first?.attachmentCount == 2)
        precondition(snapshot.attachments.first?.size == 42)
        precondition(snapshot.tokenUsage?.inputTokens == 987654)
        precondition(snapshot.tokenUsage?.lastRequestTokens == 123456)
        precondition(snapshot.preferences?.language == "en")
        precondition(snapshot.preferences?.barkConfigured == true)
        precondition(snapshot.approvalPanel?.items.first?.value == "\"accept\"")
        let roundTrip = try JSONDecoder().decode(NativeSnapshot.self, from: JSONEncoder().encode(snapshot))
        precondition(roundTrip.groups.first?.allItems?.first?.cwd == "/项目")
        print("AgentApp projection decoded")
    }
}
