require 'xcodeproj'
root = File.expand_path('..', __dir__)
project_path = ARGV[0] || File.join(root, '.mobile-build/ios/pakeplus/PakePlus.xcodeproj')
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == 'PakePlus' }
app_scheme = Xcodeproj::XCScheme.new
app_scheme.add_build_target(app)
app_scheme.set_launch_target(app)
app_scheme.save_as(project_path, 'PakePlus', true)
target = project.targets.find { |t| t.name == 'CodexMobileUITests' }
if target
  puts '模拟器 UI 测试 target 已存在'
  exit
end
target = project.new_target(:ui_test_bundle, 'CodexMobileUITests', :ios, '15.6')
target.add_dependency(app)
source = project.main_group.new_group('CodexMobileUITests')
source.new_file(ARGV[1] || File.join(root, 'mobile/ios/CodexMobileUITests.swift')).tap { |f| target.source_build_phase.add_file_reference(f) }
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
