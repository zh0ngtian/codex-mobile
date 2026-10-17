import AVFoundation
import PhotosUI
import SwiftUI
import Vision
import VisionKit

struct DeviceQRCodeScanner: View {
    @Environment(AppPreferences.self) private var preferences
    @Environment(\.dismiss) private var dismiss
    let onAddress: (String) -> Void
    @State private var cameraPresented = false
    @State private var photosPresented = false
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var isReading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 74, weight: .light))
                        .foregroundStyle(.secondary)
                        .padding(.top, 24)
                    VStack(spacing: 10) {
                        Text(preferences.text("扫描网关二维码", "Scan gateway QR code")).font(.body)
                        Text(preferences.text("扫描网关连接二维码，或从照片中识别地址。识别后只填入连接表单，不会自动保存设备。", "Scan a gateway connection QR code, or read one from a photo. Recognition fills the connection form without saving a device."))
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    VStack(spacing: 12) {
                        Button(preferences.text("扫描二维码", "Scan QR code"), systemImage: "qrcode") { Task { await openCamera() } }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("device.scan")
                        Button(preferences.text("从照片识别", "Read from photo"), systemImage: "photo") { photosPresented = true }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("device.scanPhoto")
                    }
                    .disabled(isReading)
                    if isReading { ProgressView(preferences.text("正在识别…", "Reading…")) }
                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.body).foregroundStyle(.red)
                    }
                    Text(preferences.text("填入后，请在连接表单点击“测试并保存”。", "After filling the form, tap Test and Save to continue."))
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .padding(24)
            }
            .navigationTitle(preferences.text("识别网关地址", "Read gateway URL"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(preferences.text("取消", "Cancel"), action: dismiss.callAsFunction)
                }
            }
            .photosPicker(isPresented: $photosPresented, selection: $selectedPhoto, matching: .images)
            .task(id: selectedPhoto) { await readPhoto() }
            .fullScreenCover(isPresented: $cameraPresented) {
                GatewayCameraScanner(chinese: !preferences.isEnglish) { value, message in
                    cameraPresented = false
                    if let value { accept(value) }
                    else if let message { error = message }
                }
            }
        }
        .tint(AgentTheme.ink)
    }

    private func openCamera() async {
        error = nil
        guard DataScannerViewController.isSupported else {
            error = preferences.text("此设备无法使用相机扫码，请从照片识别或手动输入地址。", "Camera scanning is unavailable on this device. Read a photo or enter the address manually.")
            return
        }
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        let granted: Bool
        if status == .notDetermined { granted = await AVCaptureDevice.requestAccess(for: .video) }
        else { granted = status == .authorized }
        guard granted, DataScannerViewController.isAvailable else {
            error = preferences.text("相机不可用，请在系统设置允许相机访问，或从照片识别。", "The camera is unavailable. Allow camera access in system settings, or read a photo.")
            return
        }
        cameraPresented = true
    }

    private func readPhoto() async {
        guard let selectedPhoto else { return }
        isReading = true
        error = nil
        defer { isReading = false }
        do {
            guard let transfer = try await selectedPhoto.loadTransferable(type: AttachmentPhotoTransfer.self) else {
                throw AttachmentImportError.missingData
            }
            let data = transfer.data
            let value = try await Task.detached { try GatewayPhotoQRCode.read(data) }.value
            guard !Task.isCancelled else { return }
            accept(value)
        } catch {
            guard !Task.isCancelled else { return }
            self.error = preferences.text("未能从照片中识别网关二维码，请更换清晰照片重试。", "No gateway QR code could be read. Try a clearer photo.")
        }
    }

    private func accept(_ value: String) {
        guard let address = DeviceGatewayAddress.validated(value) else {
            error = preferences.text("二维码不是包含 token 的有效 HTTP(S) 网关地址。", "This QR code is not a valid HTTP(S) gateway URL containing a token.")
            return
        }
        onAddress(address)
        dismiss()
    }
}

private struct GatewayCameraScanner: UIViewControllerRepresentable {
    let chinese: Bool
    let completion: (String?, String?) -> Void
    func makeUIViewController(context: Context) -> UINavigationController {
        UINavigationController(rootViewController: NativeQRScannerController(chinese: chinese, completion: completion))
    }
    func updateUIViewController(_ controller: UINavigationController, context: Context) {}
}

private enum GatewayPhotoQRCode {
    nonisolated static func read(_ data: Data) throws -> String {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        try VNImageRequestHandler(data: data).perform([request])
        guard let value = request.results?.compactMap(\.payloadStringValue).first(where: { DeviceGatewayAddress.validated($0) != nil }) else {
            throw AttachmentImportError.missingData
        }
        return value
    }
}
