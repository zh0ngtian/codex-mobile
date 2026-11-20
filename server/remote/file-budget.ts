// 所有文件协议（含不同适配器、账号和session）共用同一个逻辑容量池。
const RESERVATION = 16 * 1024 * 1024;
const GLOBAL_MEMORY = 64 * 1024 * 1024;
let active = 0;
let memory = 0;

export function reserveFileBudget(): (() => void) | undefined {
  if (active >= 4 || memory + RESERVATION > GLOBAL_MEMORY) return undefined;
  active++; memory += RESERVATION;
  let released = false;
  return () => {
    if (released) return;
    released = true; active--; memory -= RESERVATION;
  };
}
