using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace CodexMobile {
    // GUI subsystem + CREATE_NO_WINDOW prevent Windows Terminal from hosting the worker.
    internal static class QuietLauncher {
        [STAThread]
        private static int Main(string[] args) {
            string action = args.Length == 0 ? "ui" : args[0];
            if (args.Length > 1 || (action != "ui" && action != "start" && action != "backend")) return 2;
            try {
                string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                    @"System32\WindowsPowerShell\v1.0\powershell.exe");
                string arguments = "-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File ";
                if (action == "backend") {
                    arguments += Quote(Path.Combine(root, "start-independent-service.ps1")) +
                        " -ConfigPath " + Quote(Path.Combine(root, "service.json"));
                } else {
                    arguments += Quote(Path.Combine(root, "manage-service.ps1")) +
                        " -ServiceRoot " + Quote(root) + " -Action " + action;
                }
                var start = new ProcessStartInfo(powershell, arguments) {
                    WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true
                };
                using (var worker = Process.Start(start)) {
                    // Drain both pipes without exposing command output or credentials in the UI.
                    worker.OutputDataReceived += delegate { };
                    worker.ErrorDataReceived += delegate { };
                    worker.BeginOutputReadLine(); worker.BeginErrorReadLine();
                    worker.WaitForExit();
                    if (worker.ExitCode != 0 && action == "ui") ShowFailure();
                    return worker.ExitCode;
                }
            } catch {
                if (action == "ui") ShowFailure();
                return 1;
            }
        }

        private static string Quote(string path) {
            // Windows file paths cannot contain quotes; these derived paths do not end in a slash.
            return "\"" + path + "\"";
        }
        private static void ShowFailure() {
            MessageBox.Show("无法打开 Codex。请查看桌面的“Codex 服务状态”，确认后台服务已就绪。",
                "Codex", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
