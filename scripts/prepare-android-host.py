#!/usr/bin/env python3
"""固定 Android WebView 容器的构建工具和系统桥依赖，不接入原生页面。"""
import re
import sys
from pathlib import Path


def replace_once(source: str, pattern: str, replacement: str, label: str) -> str:
    source, count = re.subn(pattern, lambda _: replacement, source)
    if count != 1:
        raise ValueError(f"固定 Android 容器的 {label} 已变化，停止配置")
    return source


def prepare(project: Path) -> None:
    catalog_path = project / "gradle/libs.versions.toml"
    catalog = catalog_path.read_text()
    for key, version in {
        "agp": "8.10.1", "kotlin": "2.1.21", "coreKtx": "1.16.0",
        "junitVersion": "1.2.1", "espressoCore": "3.6.1",
    }.items():
        catalog = replace_once(catalog, rf'(?m)^{key} = "[^"]+"$', f'{key} = "{version}"', key)

    wrapper_path = project / "gradle/wrapper/gradle-wrapper.properties"
    wrapper = replace_once(wrapper_path.read_text(), r"gradle-[\d.]+-bin.zip", "gradle-8.11.1-bin.zip", "Gradle")
    gradle_path = project / "app/build.gradle.kts"
    gradle = replace_once(gradle_path.read_text(), r"compileSdk = \d+", "compileSdk = 36", "compileSdk")
    # MainActivity 和独立网页浏览器均使用 enableEdgeToEdge，直接依赖 activity-ktx。
    dependency = '    implementation("androidx.activity:activity-ktx:1.10.1")'
    if dependency not in gradle:
        gradle = replace_once(gradle, r"(?m)^dependencies \{$", "dependencies {\n" + dependency, "依赖块")

    catalog_path.write_text(catalog)
    wrapper_path.write_text(wrapper)
    gradle_path.write_text(gradle)


if __name__ == "__main__":
    prepare(Path(sys.argv[1]).resolve())
