// 使用 Node 设置环境变量，避免 Windows cmd 无法解析 POSIX 的 VAR=value 前缀。
process.env.NODE_ENV = "production";
await import("../server/index.ts");
