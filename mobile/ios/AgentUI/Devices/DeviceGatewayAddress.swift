import Foundation

enum DeviceGatewayAddress {
    static func validated(_ value: String) -> String? {
        let address = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: address),
              ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else { return nil }
        let tokens = components.queryItems?.filter { $0.name == "token" } ?? []
        guard tokens.count == 1, let token = tokens.first?.value,
              !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return address
    }
}
