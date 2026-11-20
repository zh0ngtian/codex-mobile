import { readFile } from 'node:fs/promises';
import { OperationQueue, type OperationInput } from '../../../server/operation-queue.js';

const [directory, source] = process.argv.slice(2);
if (!directory || !source) throw new Error('需要独立队列目录和合成输入文件');
// 仅磁盘/进程恢复夹具，固定合成权限；真实Target授权由inventory专项另验。
const queue = new OperationQueue({ directory, gatewayId: 'gateway', authorize: async () => () => {} });
const inputs: OperationInput[] = JSON.parse(await readFile(source, 'utf8'));
const receipts = [];
for (const input of inputs) receipts.push(await queue.submit(input));
process.stdout.write(JSON.stringify(receipts));
