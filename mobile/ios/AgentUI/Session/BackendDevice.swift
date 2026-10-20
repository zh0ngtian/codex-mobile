import Foundation

struct BackendDevice: Identifiable, Codable, Equatable, Sendable {
    var id = UUID()
    var name: String
    var gatewayAddress: String
    var enabled = true
    var connection: DeviceConnectionState = .connected
    var projects: [String] = []
    var capabilities = DeviceCapabilities()
    var savedConfiguration = ComposerConfiguration()
    var rememberedProject: String?
    var accountKey = ""

    private enum CodingKeys: String, CodingKey {
        case id, name, gatewayAddress, enabled, connection, projects, capabilities, savedConfiguration, rememberedProject, accountKey
    }
}

extension BackendDevice {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        gatewayAddress = try values.decode(String.self, forKey: .gatewayAddress)
        enabled = try values.decode(Bool.self, forKey: .enabled)
        connection = try values.decode(DeviceConnectionState.self, forKey: .connection)
        projects = try values.decode([String].self, forKey: .projects)
        capabilities = try values.decode(DeviceCapabilities.self, forKey: .capabilities)
        savedConfiguration = try values.decode(ComposerConfiguration.self, forKey: .savedConfiguration)
        rememberedProject = try values.decodeIfPresent(String.self, forKey: .rememberedProject)
        accountKey = try values.decodeIfPresent(String.self, forKey: .accountKey) ?? ""
    }
}
