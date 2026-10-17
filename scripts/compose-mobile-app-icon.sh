#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(dirname -- "$script_dir")
source_icon="$project_dir/docs/assets/app-icon/apple-intelligence-symbol-1024.png"
output_icon="$project_dir/docs/assets/app-icon/codex-mobile-app-icon-1024.png"

usage() {
  cat <<'HELP'
用法：
  compose-mobile-app-icon.sh [--output <路径>]
  compose-mobile-app-icon.sh --help | -h

选项：
  --output <路径>  指定生成图标的 PNG 路径
  -h, --help       显示帮助

默认使用仓库内的白底黑色 Apple Intelligence SF Symbol 原件，离线铺白后生成 1024×1024 PNG。
HELP
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "--output 缺少路径。" >&2
        usage >&2
        exit 1
      fi
      output_icon=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ ! -f "$source_icon" ]; then
  echo "找不到仓库内的 Apple Intelligence SF Symbol 原件：$source_icon" >&2
  exit 1
fi

mkdir -p "$(dirname -- "$output_icon")"
node - "$project_dir" "$source_icon" "$output_icon" <<'NODE'
const { createRequire } = require("node:module");
const [projectDir, source, output] = process.argv.slice(2);
const sharp = createRequire(`${projectDir}/package.json`)("sharp");

sharp(source)
  .flatten({ background: "#ffffff" })
  .removeAlpha()
  .png()
  .toFile(output)
  .then(() => process.stdout.write(`${output}\n`))
  .catch((error) => {
    console.error(`无法读取 Apple Intelligence SF Symbol 原件或生成 PNG：${error.message}`);
    process.exitCode = 1;
  });
NODE
