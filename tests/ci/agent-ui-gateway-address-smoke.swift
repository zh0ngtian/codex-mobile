import Foundation

@main struct AgentGatewayAddressSmoke {
    static func main() {
        let address = "https://gateway.example/connect?token=test-token&mode=mobile"
        precondition(DeviceGatewayAddress.validated(" \n\(address)\n") == address)
        precondition(DeviceGatewayAddress.validated("http://192.0.2.1:18766/?token=test-token") != nil)
        for value in ["https://gateway.example", "https://gateway.example/?token=", "javascript:alert(1)", "file:///tmp/?token=x", "https://gateway.example/?token=%20", "https://user:password@gateway.example/?token=x", "https://gateway.example/?token=first&token=second"] {
            precondition(DeviceGatewayAddress.validated(value) == nil, "非网关地址不能被二维码导入：\(value)")
        }
        print("Agent gateway address smoke passed")
    }
}
