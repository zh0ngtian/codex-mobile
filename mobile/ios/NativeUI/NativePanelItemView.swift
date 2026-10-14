import SwiftUI

struct NativePanelItemView: View {
    let item: NativePanelItem
    let store: NativeUIStore
    var body: some View {
        Group {
            switch item.kind {
            case "section":
                Section(item.title ?? "") { ForEach(item.children ?? []) { child in NativePanelItemView(item: child, store: store) } }
            case "markdown": NativeMarkdownView(text: item.text ?? "", scale: store.snapshot.fontScale)
            case "code", "diff": NativeCodeView(text: item.text ?? "", language: item.kind == "diff" ? "diff" : item.title ?? "")
            case "image":
                if let url = URL(string: item.value ?? "") {
                    AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { ProgressView() }
                        .accessibilityLabel(item.title ?? store.label("图片", "Image"))
                }
            case "link":
                if let url = URL(string: item.value ?? ""), ["https", "http"].contains(url.scheme?.lowercased() ?? "") { Link(item.title ?? item.value ?? "", destination: url) }
            case "action": Button(item.title ?? "") { store.perform(item.command) }.frame(minHeight: 44)
            case "toggle": Toggle(item.title ?? "", isOn: toggleBinding)
            case "textField": TextField(item.title ?? "", text: textBinding)
            case "secureField": SecureField(item.title ?? "", text: textBinding)
            case "multilineField": TextField(item.title ?? "", text: textBinding, axis: .vertical).lineLimit(3...10)
            case "singleChoice":
                Picker(item.title ?? "", selection: textBinding) { ForEach(item.options ?? []) { option in Text(option.title).tag(option.value) } }
            case "multiChoice":
                VStack(alignment: .leading) {
                    if let title = item.title { Text(title).font(.headline) }
                    ForEach(item.options ?? []) { option in
                        Toggle(option.title, isOn: choiceBinding(option.value))
                    }
                }
            default:
                VStack(alignment: .leading, spacing: 8) {
                    if let title = item.title { Text(title).font(.headline) }
                    if let text = item.text { Text(text).textSelection(.enabled) }
                }
            }
        }.disabled(item.disabled == true)
    }
    private var textBinding: Binding<String> {
        Binding(get: { store.fieldValues[item.id] ?? item.value ?? "" }, set: { value in
            store.fieldValues[item.id] = value
            update(["value": .string(value)])
        })
    }
    private var toggleBinding: Binding<Bool> {
        Binding(get: { (store.fieldValues[item.id] ?? item.value) == "true" }, set: { value in
            store.fieldValues[item.id] = value ? "true" : "false"
            update(["value": .bool(value)])
        })
    }
    private func choiceBinding(_ value: String) -> Binding<Bool> {
        Binding(get: { (store.fieldSelections[item.id] ?? item.values ?? []).contains(value) }, set: { selected in
            var values = store.fieldSelections[item.id] ?? item.values ?? []
            values.removeAll { $0 == value }
            if selected { values.append(value) }
            store.fieldSelections[item.id] = values
            update(["values": .array(values.map { .string($0) })])
        })
    }
    private func update(_ values: [String: NativeJSONValue]) {
        guard let command = item.command else { return }
        store.command(command.name, command.params.merging(values) { _, new in new })
    }
}
