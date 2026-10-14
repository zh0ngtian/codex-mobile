import Foundation

struct NativeCommand: Codable, Identifiable {
    var id: String
    var name: String
    var params: [String: NativeJSONValue]

    init(id: String = UUID().uuidString, name: String, params: [String: NativeJSONValue] = [:]) {
        self.id = id; self.name = name; self.params = params
    }
    private enum CodingKeys: String, CodingKey { case id, name, params }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // 展示动作的 TS id 可省略；真正执行时 store 仍分配新的请求 UUID。
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try container.decode(String.self, forKey: .name)
        params = try container.decode([String: NativeJSONValue].self, forKey: .params)
    }
}
