#!/usr/bin/env python3
"""将受版本控制的 Compose 呈现层接入固定 PakePlus 容器，不构建或发布安装包。"""
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def replace_once(source: str, anchor: str, replacement: str, label: str) -> str:
    if source.count(anchor) != 1:
        raise ValueError(f"固定 Android 容器的 {label} 已变化，停止接入")
    return source.replace(anchor, replacement, 1)


def prepare(project: Path, root: Path) -> None:
    template = root / "mobile/android/native-ui"
    target = project / "app/src/main/java/com/app/pakeplus/nativeui"
    target.mkdir(parents=True, exist_ok=True)
    for source in template.glob("*.kt"):
        shutil.copyfile(source, target / source.name)
    test_target = project / "app/src/androidTest/java/com/app/pakeplus/nativeui"
    test_target.mkdir(parents=True, exist_ok=True)
    for source in (root / "mobile/android/native-ui-tests").glob("*.kt"):
        shutil.copyfile(source, test_target / source.name)
    debug_manifest = project / "app/src/debug/AndroidManifest.xml"
    debug_manifest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / "mobile/android/native-ui-tests/AndroidManifest.xml", debug_manifest)
    assets = project / "app/src/main/assets"
    assets.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(template / "bootstrap.js", assets / "native-ui-bootstrap.js")

    activity_path = project / "app/src/main/java/com/app/pakeplus/MainActivity.kt"
    source = activity_path.read_text()
    if "private var nativeUIHost:" not in source:
        source = replace_once(source, "    private lateinit var webView: WebView\n",
            "    private lateinit var webView: WebView\n    private var nativeUIHost: com.app.pakeplus.nativeui.AndroidNativeHost? = null\n", "WebView 字段")
        source = replace_once(source, "        webView.loadUrl(webUrl)",
            "        nativeUIHost = com.app.pakeplus.nativeui.AndroidNativeHost(this, webView).also { it.install() }\n        webView.loadUrl(webUrl)", "首页加载")
        source = replace_once(source, "        webView.onPause()", "        nativeUIHost?.setActive(false)\n        webView.onPause()", "后台回调")
        source = replace_once(source, "        webView.onResume()", "        webView.onResume()\n        nativeUIHost?.setActive(true)", "前台回调")
        source = replace_once(source, "        webView.destroy()", "        nativeUIHost?.dispose()\n        webView.destroy()", "销毁回调")
        source = replace_once(source, "            super.onPageFinished(view, url)",
            "            super.onPageFinished(view, url)\n            nativeUIHost?.pageReady()", "页面完成")
        source = replace_once(source, "            fileUploadCallback?.onReceiveValue(results)",
            "            fileUploadCallback?.onReceiveValue(results)\n            if (results == null) webView.evaluateJavascript(\"window.codexMobileAttachmentPickerCancelled?.()\", null)", "附件取消")
        activity_path.write_text(source)

    catalog_path = project / "gradle/libs.versions.toml"
    catalog = catalog_path.read_text()
    for key, version in {"agp": "8.10.1", "kotlin": "2.1.21", "coreKtx": "1.16.0", "junitVersion": "1.2.1", "espressoCore": "3.6.1"}.items():
        catalog, count = re.subn(rf'(?m)^{key} = "[^"]+"$', f'{key} = "{version}"', catalog)
        if count != 1:
            raise ValueError(f"Android 依赖版本字段缺失：{key}")
    catalog_path.write_text(catalog)
    wrapper_path = project / "gradle/wrapper/gradle-wrapper.properties"
    wrapper = wrapper_path.read_text()
    wrapper = re.sub(r"gradle-[\d.]+-bin.zip", "gradle-8.11.1-bin.zip", wrapper)
    wrapper_path.write_text(wrapper)

    gradle_path = project / "app/build.gradle.kts"
    gradle = gradle_path.read_text()
    if 'id("org.jetbrains.kotlin.plugin.compose")' not in gradle:
        gradle = replace_once(gradle, "    alias(libs.plugins.jetbrainsKotlinAndroid)",
            '    alias(libs.plugins.jetbrainsKotlinAndroid)\n    id("org.jetbrains.kotlin.plugin.compose") version "2.1.21"', "Kotlin 插件")
        gradle = replace_once(gradle, "        viewBinding = true", "        viewBinding = true\n        compose = true\n        buildConfig = true", "Compose 构建特性")
    dependencies = '''
    // BEGIN CODEX NATIVE UI
    // Android 原生呈现；固定版本，与共享业务协议无关。
    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.webkit:webkit:1.13.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-svg:2.7.0")
    implementation("io.noties.markwon:core:4.6.2")
    implementation("io.noties.markwon:ext-strikethrough:4.6.2")
    implementation("io.noties.markwon:ext-tables:4.6.2")
    implementation("io.noties.markwon:ext-tasklist:4.6.2")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.06.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    // END CODEX NATIVE UI
'''
    if "// BEGIN CODEX NATIVE UI" in gradle:
        gradle = re.sub(r"    // BEGIN CODEX NATIVE UI[\s\S]*?    // END CODEX NATIVE UI\n", dependencies.strip("\n") + "\n", gradle)
    elif "// Android 原生呈现" in gradle:
        gradle = re.sub(r"    // Android 原生呈现[\s\S]*?(?=    implementation\(libs\.)", dependencies.strip("\n") + "\n", gradle)
    else:
        gradle = replace_once(gradle, "dependencies {", "dependencies {\n" + dependencies, "依赖块")
    gradle = re.sub(r"compileSdk = \d+", "compileSdk = 36", gradle)
    gradle_path.write_text(gradle)
    manifest_path = project / "app/src/main/AndroidManifest.xml"
    android = "http://schemas.android.com/apk/res/android"
    ET.register_namespace("android", android)
    ET.register_namespace("tools", "http://schemas.android.com/tools")
    tree = ET.parse(manifest_path)
    application = tree.getroot().find("application")
    if application is None:
        raise ValueError("Android manifest 缺少 application")
    application.set(f"{{{android}}}enableOnBackInvokedCallback", "true")
    tree.write(manifest_path, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    prepare(Path(sys.argv[1]).resolve(), Path(__file__).resolve().parent.parent)
