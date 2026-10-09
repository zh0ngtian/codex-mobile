# Web 对比界面规范

继承 MASTER.md 的内容优先、黑白灰与阅读参数，用同一份会话和草稿比较 UIKit 与 Web。Web 正文17px，按钮至少44px，控件间8px；手机阅读左右20px，输入左右12px，iPad 边栏最多420px，正文最多720px。次级文字使用不透明语义色，系统深浅色独立验证。辅助字号/特大字号不压缩正文。

对话顶栏一行，次级状态收敛，工具和执行过程沿用折叠入口，模型/权限/设备和项目通过现有设置访问。单行输入不为放大按钮预留无效空间，多行展开保留；短用户消息贴合内容，代码保留等宽和缩进，宽表格只在自身滚动。

边栏固定顶部与底部新聊天、中间列表独立滚动；搜索在设备选择下方，明确label、清除、空态提示、失败和重试，键盘出现仍能操作关闭与搜索。原生模式隐藏旧 Web 抽屉；网页模式两个原生桥均hide，恢复时重发快照。

检索：`chat mobile reading hierarchy --domain ux` 顶项为 Web Breadcrumbs，与聊天阅读目标不合；收窄 `typography readable body text --domain ux` 命中 Contrast Readability、Readable Font Size、Color Contrast，采用可读正文与4.5:1对比规则。`state context localStorage --stack react` 命中全局状态共享，界面偏好使用稳定订阅 store，草稿仍留在原业务层。
