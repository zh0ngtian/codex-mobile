import Foundation

/// 离线 UI 验收使用的短静音 WAV，不访问设备文件或业务会话。
enum NativeReferenceAudio {
    static func source() -> String {
        let samples = Data(repeating: 0, count: 1600)
        var bytes = Data("RIFF".utf8)
        func append<T: FixedWidthInteger>(_ value: T) {
            var value = value.littleEndian
            withUnsafeBytes(of: &value) { bytes.append(contentsOf: $0) }
        }
        append(UInt32(36 + samples.count))
        bytes.append(Data("WAVEfmt ".utf8))
        append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
        append(UInt32(8000)); append(UInt32(16000)); append(UInt16(2)); append(UInt16(16))
        bytes.append(Data("data".utf8)); append(UInt32(samples.count)); bytes.append(samples)
        return "data:audio/wav;base64,\(bytes.base64EncodedString())"
    }
}
