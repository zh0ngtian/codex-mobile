export function pathBasename(path: string): string {
  return path.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}
