require 'xcodeproj'
root = File.expand_path('..', __dir__)
project_path = ARGV[0] || File.join(root, '.mobile-build/ios/pakeplus/PakePlus.xcodeproj')
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == 'PakePlus' }
app_scheme = Xcodeproj::XCScheme.new
app_scheme.add_build_target(app)
app_scheme.set_launch_target(app)
app_scheme.save_as(project_path, 'PakePlus', true)
# 探针仅安装到显式配置的 UI 测试工程，普通 ios:prepare 和发布流水线不使用。
probe_path = File.join(root, 'mobile/ios/KeyboardLayoutProbe.swift')
probe = project.files.find { |f| f.real_path.to_s == probe_path }
unless probe
  group = project.main_group.new_group('CodexMobileTestSupport')
  probe = group.new_file(probe_path)
  app.source_build_phase.add_file_reference(probe)
end
webview_path = File.join(File.dirname(project_path), 'PakePlus/WebView.swift')
webview = File.read(webview_path)
constructor = 'let webView = CodexMobileWebView(frame: .zero, configuration: webConfiguration)'
probe_constructor = 'let webView = KeyboardLayoutProbeWebView(frame: .zero, configuration: webConfiguration)'
if webview.include?(constructor)
  File.write(webview_path, webview.sub(constructor, probe_constructor))
elsif !webview.include?(probe_constructor)
  abort '固定 PakePlus WebView 构造入口已变化，无法安装键盘布局探针'
end
project.save
target = project.targets.find { |t| t.name == 'CodexMobileUITests' }
# 原生交互回归与旧 Web 回归共用 target，但通过 only-testing 分别执行。
native_test_path = File.join(root, 'mobile/ios/NativeConversationUITests.swift')
sidebar_test_path = File.join(root, 'mobile/ios/NativeSidebarUITests.swift')
if target
  extra_path = File.join(root, 'mobile/ios/SmallFontKeyboardUITests.swift')
  unless project.files.any? { |f| f.real_path.to_s == extra_path }
    group = project.main_group.find_subpath('CodexMobileUITests', false)
    target.source_build_phase.add_file_reference(group.new_file(extra_path))
    project.save
  end
  unless project.files.any? { |f| f.real_path.to_s == native_test_path }
    group = project.main_group.find_subpath('CodexMobileUITests', false)
    target.source_build_phase.add_file_reference(group.new_file(native_test_path))
    project.save
  end
  unless project.files.any? { |f| f.real_path.to_s == sidebar_test_path }
    group = project.main_group.find_subpath('CodexMobileUITests', false)
    target.source_build_phase.add_file_reference(group.new_file(sidebar_test_path))
    project.save
  end
  puts '模拟器 UI 测试 target 已存在'
  exit
end
target = project.new_target(:ui_test_bundle, 'CodexMobileUITests', :ios, '15.6')
target.add_dependency(app)
source = project.main_group.new_group('CodexMobileUITests')
source.new_file(ARGV[1] || File.join(root, 'mobile/ios/CodexMobileUITests.swift')).tap { |f| target.source_build_phase.add_file_reference(f) }
source.new_file(File.join(root, 'mobile/ios/SmallFontKeyboardUITests.swift')).tap { |f| target.source_build_phase.add_file_reference(f) }
source.new_file(native_test_path).tap { |f| target.source_build_phase.add_file_reference(f) }
source.new_file(sidebar_test_path).tap { |f| target.source_build_phase.add_file_reference(f) }
target.build_configurations.each do |config|
 config.build_settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
 config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'vip.loock.codexmobile.uitests'
 config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
 config.build_settings['SWIFT_VERSION'] = '5.0'
 config.build_settings['TEST_TARGET_NAME'] = 'PakePlus'
 config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.set_launch_target(app)
scheme.save_as(project_path, 'CodexMobileUITests', true)
puts '已生成 CodexMobileUITests scheme'
