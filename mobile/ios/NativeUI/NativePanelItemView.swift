import SwiftUI

struct NativePanelItemView: View {
    let item: NativePanelItem
    let store: NativeUIStore
    let scope: NativeFieldScope
    var body: some View {
        Group {
            switch item.kind {
            case "section":
                Section(item.title ?? "") {
                    if let text = item.text { Text(text).foregroundStyle(.secondary).textSelection(.enabled) }
                    ForEach(item.children ?? []) { child in NativePanelItemView(item: child, store: store, scope: scope) }
                }
            case "disclosure":
                DisclosureGroup(item.title ?? "") {
                    if let text = item.text { Text(text).foregroundStyle(.secondary).textSelection(.enabled) }
                    ForEach(item.children ?? []) { child in NativePanelItemView(item: child, store: store, scope: scope) }
                }
            case "markdown": NativeMarkdownView(text: item.text ?? "", scale: store.snapshot.fontScale, store: store)
            case "code", "diff": NativeCodeView(text: item.text ?? "", language: item.kind == "diff" ? "diff" : item.title ?? "", scale: store.snapshot.fontScale)
            case "source": NativeSourceCodeView(text: item.text ?? "", title: item.title ?? "", targetLine: item.line, scale: store.snapshot.fontScale)
            case "image":
                NativeImageView(source: item.value ?? "", title: item.title ?? store.label("图片", "Image"), previewSource: item.previewURL)
            case "html": NativeHTMLContentView(html: item.value ?? item.text ?? "", title: item.title ?? "")
            case "audio", "video": NativeMediaView(source: item.value ?? "", title: item.title ?? "", audio: item.kind == "audio")
            case "file":
                VStack(alignment: .leading, spacing: 8) {
                    if item.command != nil {
                        Button(item.title ?? store.label("查看文件", "View File"), systemImage: "doc") { store.perform(item.command) }
                    } else if let title = item.title { Label(title, systemImage: "doc") }
                    if let text = item.text { Text(text).font(.body).foregroundStyle(.secondary).textSelection(.enabled) }
                    if let source = item.value { NativeFileDownloadView(source: source, title: item.title ?? "file") }
                }
            case "link":
                if let url = URL(string: item.value ?? ""), ["https", "http"].contains(url.scheme?.lowercased() ?? "") { Link(item.title ?? item.value ?? "", destination: url) }
            case "action":
                Button { store.perform(item.command) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title ?? "")
                        if let text = item.text { Text(text).foregroundStyle(.secondary).modifier(NativeScaledFont(size: 13, scale: store.snapshot.fontScale, relativeTo: .caption)) }
                    }.frame(minHeight: 44, alignment: .leading)
                }
            case "toggle": NativeFieldRow(text: item.text, scale: store.snapshot.fontScale) { Toggle(item.title ?? "", isOn: toggleBinding) }
            case "textField": NativeFieldRow(text: item.text, scale: store.snapshot.fontScale) { TextField(item.title ?? "", text: textBinding).accessibilityIdentifier("native-field-\(item.id)") }
            case "secureField": NativeFieldRow(text: item.text, scale: store.snapshot.fontScale) { SecureField(item.title ?? "", text: textBinding) }
            case "multilineField": NativeFieldRow(text: item.text, scale: store.snapshot.fontScale) { TextField(item.title ?? "", text: textBinding, axis: .vertical).lineLimit(3...10) }
            case "singleChoice":
                NativeFieldRow(text: item.text, scale: store.snapshot.fontScale) {
                    Picker(item.title ?? "", selection: textBinding) { ForEach(item.options ?? []) { option in NativeChoiceOptionView(option: option, scale: store.snapshot.fontScale).tag(option.value) } }
                }
            case "multiChoice":
                VStack(alignment: .leading) {
                    if let title = item.title { Text(title).modifier(NativeScaledFont(size: 17, scale: store.snapshot.fontScale, weight: .semibold, relativeTo: .headline)) }
                    if let text = item.text { Text(text).foregroundStyle(.secondary).textSelection(.enabled) }
                    ForEach(item.options ?? []) { option in
                        Toggle(isOn: choiceBinding(option.value)) { NativeChoiceOptionView(option: option, scale: store.snapshot.fontScale) }
                    }
                }
            default:
                VStack(alignment: .leading, spacing: 8) {
                    if let title = item.title { Text(title).modifier(NativeScaledFont(size: 17, scale: store.snapshot.fontScale, weight: .semibold, relativeTo: .headline)) }
                    if let text = item.text { Text(text).textSelection(.enabled) }
                }
            }
        }.disabled(item.disabled == true)
            .modifier(NativeScaledFont(size: 16, scale: store.snapshot.fontScale))
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
        store.sendFieldEdit(item, scope: scope, values: values)
    }
}
