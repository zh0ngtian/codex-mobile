#if NATIVE_MARKDOWN_TESTS
import Foundation
#if canImport(UIKit)
import UIKit
#endif

@main
struct NativeMarkdownTests {
    struct Example {
        let name: String
        let source: String
        let blocks: [NativeMarkdownBlock]
    }

    static func main() {
        let examples: [Example] = [
            .init(name: "空正文不产生占位块", source: " \n\t\n", blocks: []),
            .init(name: "段内换行与空格保留", source: "第一行  \n第二行\n\n  下一段", blocks: [
                .paragraph("第一行  \n第二行"), .paragraph("  下一段")
            ]),
            .init(name: "Windows 换行正常分段", source: "甲\r\n乙\r\n\r\n丙", blocks: [
                .paragraph("甲\n乙"), .paragraph("丙")
            ]),
            .init(name: "ATX 标题保留层级并去掉结束标记", source: "# 一级\n### 三级 ###\n###### 六级", blocks: [
                .heading(level: 1, text: "一级"), .heading(level: 3, text: "三级"), .heading(level: 6, text: "六级")
            ]),
            .init(name: "Setext 标题与单独分隔线可区分", source: "标题\n===\n\n子标题\n---\n\n---\n\n* * *", blocks: [
                .heading(level: 1, text: "标题"), .heading(level: 2, text: "子标题"), .divider, .divider
            ]),
            .init(name: "不完整标题仍为正文", source: "#hashtag\n####### 超过六级\n#", blocks: [
                .paragraph("#hashtag\n####### 超过六级"), .heading(level: 1, text: "")
            ]),
            .init(name: "空标题不露出结束 hash marker", source: "# ###\n## ### ###", blocks: [
                .heading(level: 1, text: ""), .heading(level: 2, text: "###")
            ]),
            .init(name: "无序列表保留续行及嵌套缩进", source: "- 第一项\n  续行\n  - 子项\n    子项续行\n- 第二项", blocks: [
                .list(ordered: false, items: ["第一项\n  续行\n  - 子项\n    子项续行", "第二项"])
            ]),
            .init(name: "有序列表支持点和右括号", source: "1. 一\n2. 二\n\n3) 三\n4) 四", blocks: [
                .list(ordered: true, items: ["一", "二", "三", "四"])
            ]),
            .init(name: "有序列表保留非一的起始编号", source: "3. 第三步\n4. 第四步", blocks: [
                .list(ordered: true, items: ["第三步", "第四步"], start: 3)
            ]),
            .init(name: "右括号编号和零起始编号也保留", source: "7) 第七项\n8) 第八项\n\n分隔正文\n\n0. 第零项", blocks: [
                .list(ordered: true, items: ["第七项", "第八项"], start: 7), .paragraph("分隔正文"), .list(ordered: true, items: ["第零项"], start: 0)
            ]),
            .init(name: "列表种类转换与后续段落独立", source: "- 无序\n1. 有序\n\n正文", blocks: [
                .list(ordered: false, items: ["无序"]), .list(ordered: true, items: ["有序"]), .paragraph("正文")
            ]),
            .init(name: "列表中的空段及嵌套内容不丢失", source: "- 主项\n\n  补充段\n\n  1. 子项\n- 次项\n\n结束", blocks: [
                .list(ordered: false, items: ["主项\n\n  补充段\n\n  1. 子项", "次项"]), .paragraph("结束")
            ]),
            .init(name: "列表保留任务状态", source: "- [x] 完成\n- [ ] 待办", blocks: [
                .list(ordered: false, items: ["[x] 完成", "[ ] 待办"])
            ]),
            .init(name: "列表整体缩进保持相对子层级", source: "  - 外层\n    - 内层\n  - 次项", blocks: [
                .list(ordered: false, items: ["外层\n  - 内层", "次项"])
            ]),
            .init(name: "暂不识别的四空格缩进正文原样保留", source: "    - literal\n    # literal", blocks: [
                .paragraph("    - literal\n    # literal")
            ]),
            .init(name: "引用连续行与内部空段", source: "> 第一行\n> 第二行\n>\n> > 内层\n\n正文", blocks: [
                .quote("第一行\n第二行\n\n> 内层"), .paragraph("正文")
            ]),
            .init(name: "代码保留缩进空行与结尾换行", source: "```swift\n  let x = 1  \n\n\tprint(x)\n```\n\n完成", blocks: [
                .code(language: "swift", text: "  let x = 1  \n\n\tprint(x)\n"), .paragraph("完成")
            ]),
            .init(name: "波浪 fence 与更长关闭 fence", source: "~~~js title=demo\nconst value = `x`;\n~~~~", blocks: [
                .code(language: "js", text: "const value = `x`;\n")
            ]),
            .init(name: "未闭合代码覆盖流式回复", source: "说明\n\n```python\n  print('中文')\n\n", blocks: [
                .paragraph("说明"), .code(language: "python", text: "  print('中文')\n\n")
            ]),
            .init(name: "代码 fence 长度与字符必须匹配", source: "````text\n```\n~~~\n````\n", blocks: [
                .code(language: "text", text: "```\n~~~\n")
            ]),
            .init(name: "代码末行没有换行也要保留", source: "```\n  尾行  ", blocks: [
                .code(language: "", text: "  尾行  ")
            ]),
            .init(name: "代码行上的伪关闭 fence 不截断", source: "```\n``` tail\n```", blocks: [
                .code(language: "", text: "``` tail\n")
            ]),
            .init(name: "标准 GFM 表格隐藏对齐分隔线", source: "| 名称 | 说明 |\n| :--- | ---: |\n| 项目 | 中文说明 |", blocks: [
                .table(headers: ["名称", "说明"], rows: [["项目", "中文说明"]])
            ]),
            .init(name: "无外侧竖线的表格同样解析", source: "名称 | 说明\n--- | ---\n甲 | 乙\n\n结束", blocks: [
                .table(headers: ["名称", "说明"], rows: [["甲", "乙"]]), .paragraph("结束")
            ]),
            .init(name: "转义竖线与代码中的竖线不会拆列", source: "| 名称\\|别名 | 表达式 |\n| --- | --- |\n| a\\|b | `x | y` |\n| c | ``a `|` b`` |", blocks: [
                .table(headers: ["名称\\|别名", "表达式"], rows: [["a\\|b", "`x | y`"], ["c", "``a `|` b``"]])
            ]),
            .init(name: "GFM 单短横线分隔符与无竖线短行", source: "A | B\n:-: | -:\n只有第一列", blocks: [
                .table(headers: ["A", "B"], rows: [["只有第一列", ""]])
            ]),
            .init(name: "代码单元格内的转义竖线不显示反斜线", source: "| 表达式 |\n| --- |\n| `x \\| y` |", blocks: [
                .table(headers: ["表达式"], rows: [["`x | y`"]])
            ]),
            .init(name: "未闭合行内代码不会吞掉表格列", source: "| A | B |\n| --- | --- |\n| `未完成 | 仍是第二列 |", blocks: [
                .table(headers: ["A", "B"], rows: [["`未完成", "仍是第二列"]])
            ]),
            .init(name: "只有表头的流式表格仍可读取", source: "| A | B |\n| --- | --- |", blocks: [
                .table(headers: ["A", "B"], rows: [])
            ]),
            .init(name: "中文长列及短行额外列不消失", source: "| A | B |\n| --- | --- |\n| 这是一段很长的中文列用于验证不会被截断或丢弃 | 条件 |\n| 少列 |\n| 多 | 列 | 保留 |", blocks: [
                .table(headers: ["A", "B", ""], rows: [["这是一段很长的中文列用于验证不会被截断或丢弃", "条件", ""], ["少列", "", ""], ["多", "列", "保留"]])
            ]),
            .init(name: "空表格单元格仍有列位", source: "| A | B | C |\n| --- | --- | --- |\n| | 值 | |", blocks: [
                .table(headers: ["A", "B", "C"], rows: [["", "值", ""]])
            ]),
            .init(name: "伪表格和普通竖线保留为正文", source: "a | b\n--x | ---\n未识别的 <tag>正文</tag>", blocks: [
                .paragraph("a | b\n--x | ---\n未识别的 <tag>正文</tag>")
            ]),
            .init(name: "表格列数不匹配时不吞掉原文", source: "| A | B |\n| --- |\n| 甲 | 乙 |", blocks: [
                .paragraph("| A | B |\n| --- |\n| 甲 | 乙 |")
            ]),
            .init(name: "表格之后的新标题不并入行", source: "A | B\n--- | ---\n甲 | 乙\n## 下一部分 | 保留", blocks: [
                .table(headers: ["A", "B"], rows: [["甲", "乙"]]), .heading(level: 2, text: "下一部分 | 保留")
            ]),
            .init(name: "普通行内 Markdown 由 renderer 处理", source: "**粗体** 和 *斜体*，`code` 与 [链接](https://example.com)", blocks: [
                .paragraph("**粗体** 和 *斜体*，`code` 与 [链接](https://example.com)")
            ]),
            .init(name: "混合消息各块保持阅读顺序", source: "## 结论\n\n这是正文。\n\n- 一\n- 二\n\n> 注意\n\n---\n\n```txt\n原样 | 内容\n```", blocks: [
                .heading(level: 2, text: "结论"), .paragraph("这是正文。"), .list(ordered: false, items: ["一", "二"]), .quote("注意"), .divider, .code(language: "txt", text: "原样 | 内容\n")
            ])
        ]
        var failures = 0
        for example in examples {
            let actual = NativeMarkdown.parse(example.source)
            if actual != example.blocks {
                failures += 1
                fputs("FAIL: \(example.name)\n  expected: \(example.blocks)\n  actual:   \(actual)\n", stderr)
            }
        }
        guard failures == 0 else {
            fputs("\(failures)/\(examples.count) Markdown cases failed\n", stderr)
            exit(1)
        }
        #if canImport(UIKit)
        testInline()
        #endif
        print("PASS: \(examples.count) NativeMarkdown paragraph/heading/list/quote/fence/table/fallback cases")
    }

    #if canImport(UIKit)
    static func testInline() {
        let baseFont = UIFont.italicSystemFont(ofSize: 19)
        let rendered = NativeMarkdown.inline("**加粗** *斜体* `命令` [链接](https://example.com)\n下一行  缩进", font: baseFont, color: .systemRed)
        require(rendered.string == "加粗 斜体 命令 链接\n下一行  缩进", "inlineOnly 保留换行与连续空格")
        let plain = rendered.string as NSString
        let bold = rendered.attribute(.font, at: plain.range(of: "加粗").location, effectiveRange: nil) as! UIFont
        require(bold.pointSize == 19 && bold.fontDescriptor.symbolicTraits.contains([.traitBold, .traitItalic]), "粗体保留 base font 大小与已有斜体")
        let code = rendered.attribute(.font, at: plain.range(of: "命令").location, effectiveRange: nil) as! UIFont
        require(code.pointSize == 19 && code.fontDescriptor.symbolicTraits.contains([.traitMonoSpace, .traitItalic]), "行内 code 使用相同字号并保留 base traits")
        require(rendered.attribute(.link, at: plain.range(of: "链接").location, effectiveRange: nil) as? URL == URL(string: "https://example.com"), "链接保持可交互 link 属性")
        rendered.enumerateAttributes(in: NSRange(location: 0, length: rendered.length)) { attributes, _, _ in
            require((attributes[.foregroundColor] as? UIColor)?.isEqual(UIColor.systemRed) == true, "所有 run 尊重传入颜色")
            let paragraph = attributes[.paragraphStyle] as! NSParagraphStyle
            require(paragraph.lineSpacing == 4 && paragraph.paragraphSpacing == 0, "inline 段落指标统一")
        }
    }

    static func require(_ condition: Bool, _ message: String) {
        guard condition else { fputs("FAIL: \(message)\n", stderr); exit(1) }
    }
    #endif
}
#endif
