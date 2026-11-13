import Foundation
import CryptoKit
import Security

struct KeyRecord: Codable {
    let keyId: String
    let sealedKeyBase64: String
}
struct HelperFailure: Error {}
func require(_ value: Bool) throws { if !value { throw HelperFailure() } }
func main() throws {
    try require(CommandLine.arguments.count == 2 && SecureEnclave.isAvailable)
    let operation = CommandLine.arguments[1]
    try require(["create", "public", "sign", "selftest"].contains(operation))
    // Read at most one byte beyond the limit, never unbounded readDataToEndOfFile.
    var input = Data()
    while input.count <= 65536 {
        let next = FileHandle.standardInput.readData(ofLength: min(4096, 65537 - input.count))
        if next.isEmpty { break }
        input.append(next)
    }
    try require(input.count <= 65536)
    guard let request = try JSONSerialization.jsonObject(with: input) as? [String: Any] else { throw HelperFailure() }
    let record: KeyRecord
    let key: SecureEnclave.P256.Signing.PrivateKey
    if operation == "create" {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, [.privateKeyUsage], &error) else { throw HelperFailure() }
        key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
        record = KeyRecord(keyId: "codex-mobile-gateway-" + UUID().uuidString.lowercased(), sealedKeyBase64: key.dataRepresentation.base64EncodedString())
    } else {
        guard let raw = request["keyRecord"] as? [String: Any] else { throw HelperFailure() }
        record = try JSONDecoder().decode(KeyRecord.self, from: JSONSerialization.data(withJSONObject: raw))
        guard let sealed = Data(base64Encoded: record.sealedKeyBase64) else { throw HelperFailure() }
        key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: sealed)
    }
    var result: [String: Any] = ["keyId": record.keyId, "publicKeySpkiDerBase64": key.publicKey.derRepresentation.base64EncodedString(), "algorithm": "ecdsa_p256_sha256", "protectionClass": "hardware_secure_enclave"]
    if operation == "create" { result["keyRecord"] = ["keyId": record.keyId, "sealedKeyBase64": record.sealedKeyBase64] }
    if operation == "sign" || operation == "selftest" {
        let message: Data
        if operation == "selftest" { message = Data("Codex Mobile own Secure Enclave key persistence test".utf8) }
        else {
            guard let encoded = request["messageBase64"] as? String, let decoded = Data(base64Encoded: encoded), decoded.count <= 65536 else { throw HelperFailure() }
            message = decoded
        }
        let signature = try key.signature(for: message)
        try require(key.publicKey.isValidSignature(signature, for: message))
        result["signatureDerBase64"] = signature.derRepresentation.base64EncodedString()
        if operation == "selftest" {
            result["restoredKeySigned"] = true
            result["tamperedMessageRejected"] = !key.publicKey.isValidSignature(signature, for: message + Data([0]))
        }
    }
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}
do { try main() } catch {
    // Never expose CryptoKit/Security errors or sealed representations.
    FileHandle.standardOutput.write(Data("{\"error\":\"Secure Enclave operation failed\"}\n".utf8))
    exit(1)
}
