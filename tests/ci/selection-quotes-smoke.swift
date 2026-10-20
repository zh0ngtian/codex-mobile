import Foundation
@main struct SelectionQuotesSmoke {
    static func main() throws {
        let source = NativeQuoteSource(backendId: "b", threadId: "t", turnId: "physical", itemId: "message", region: "body", revision: "1")
        let selection = NativeQuoteSelection(source: source, renderedText: "😀重复，重复", range: NSRange(location: 5, length: 2))
        let params = selection.params(contextID: "context")!
        precondition(params["text"] == .string("重复"), "按UTF16范围保存第二次重复显示文字")
        precondition(params["contextId"] == .string("context"))
        precondition(NativeQuoteSelection(source: source, renderedText: "😀", range: NSRange(location: 0, length: 2)).params(contextID: "c")?["text"] == .string("😀"))
        precondition(NativeQuoteSelection(source: source, renderedText: "abc", range: NSRange(location: NSNotFound, length: 3)).params(contextID: "c") == nil)
        let quote = NativeMessageQuote(id: "q", source: source, text: "重复")
        let decoded = try JSONDecoder().decode(NativeMessageQuote.self, from: JSONEncoder().encode(quote))
        precondition(decoded == quote)
        print("Selection quote smoke passed")
    }
}
