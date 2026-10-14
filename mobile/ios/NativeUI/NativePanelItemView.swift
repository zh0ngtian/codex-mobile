import SwiftUI

struct NativePanelItemView: View {
    let item: NativePanelItem
    let store: NativeUIStore
    let scope: NativeFieldScope
    var body: some View {
        Group {
            switch item.kind {
            case "section":
                Section(item.title ?? "") { ForEach(item.children ?? []) { child in NativePanelItemView(item: child, store: store, scope: scope) } }
            case "markdown": NativeMarkdownView(text: item.text ?? "", scale: store.snapshot.fontScale)
            case "code", "diff": NativeCodeView(text: item.text ?? "", language: item.kind == "diff" ? "diff" : item.title ?? "", scale: store.snapshot.fontScale)
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
        Binding(get: { store.fieldValue(item, scope: scope) }, set: { value in
            store.setFieldValue(value, item: item, scope: scope)
            update(["value": .string(value)])
        })
    }
    private var toggleBinding: Binding<Bool> {
        Binding(get: { store.fieldValue(item, scope: scope) == "true" }, set: { value in
            store.setFieldValue(value ? "true" : "false", item: item, scope: scope)
            update(["value": .bool(value)])
        })
    }
    private func choiceBinding(_ value: String) -> Binding<Bool> {
        Binding(get: { store.selectedValues(item, scope: scope).contains(value) }, set: { selected in
            var values = store.selectedValues(item, scope: scope)
            values.removeAll { $0 == value }
            if selected { values.append(value) }
            store.setSelectedValues(values, item: item, scope: scope)
            update(["values": .array(values.map { .string($0) })])
        })
    }
    private func update(_ values: [String: NativeJSONValue]) {
        guard let command = item.command else { return }
        store.command(command.name, command.params.merging(values) { _, new in new })
    }
}
