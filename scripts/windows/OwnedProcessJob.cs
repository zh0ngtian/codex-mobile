using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace CodexMobile {
    // Job 句柄不继承给子进程。宿主正常关闭或异常死亡时，Windows 清理整个所属进程树。
    public sealed class OwnedProcessJob : IDisposable {
        private IntPtr handle;

        public OwnedProcessJob() {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception();
            var info = new ExtendedLimitInformation();
            info.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(handle, 9, ref info, (uint)Marshal.SizeOf(info))) {
                var error = new Win32Exception();
                Dispose();
                throw error;
            }
        }

        public Process Start(string executable, string[] arguments, string workingDirectory, bool visible) {
            if (handle == IntPtr.Zero) throw new ObjectDisposedException("OwnedProcessJob");
            if (!Path.IsPathRooted(executable) || !File.Exists(executable))
                throw new ArgumentException("需要存在的绝对可执行文件路径", "executable");
            var command = new StringBuilder(Quote(executable));
            foreach (string argument in arguments) command.Append(" ").Append(Quote(argument));
            var startup = new StartupInfo();
            startup.cb = (uint)Marshal.SizeOf(startup);
            startup.dwFlags = 1; // STARTF_USESHOWWINDOW
            startup.wShowWindow = (short)(visible ? 1 : 0);
            ProcessInformation process;
            // 暂停创建，先归入 Job 再执行，避免子孙进程在绑定前逃逸。
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false,
                0x4 | 0x08000000, IntPtr.Zero, workingDirectory, ref startup, out process))
                throw new Win32Exception();
            try {
                if (!AssignProcessToJobObject(handle, process.hProcess)) throw new Win32Exception();
                var result = Process.GetProcessById((int)process.dwProcessId);
                // 暂停期间取得进程句柄，后续等待不受 PID 重用影响。
                var processHandle = result.Handle;
                if (ResumeThread(process.hThread) == uint.MaxValue) throw new Win32Exception();
                return result;
            } catch {
                TerminateProcess(process.hProcess, 1);
                throw;
            } finally {
                CloseHandle(process.hThread);
                CloseHandle(process.hProcess);
            }
        }

        private static string Quote(string value) {
            var result = new StringBuilder("\"");
            int slashes = 0;
            foreach (char ch in value) {
                if (ch == '\\') { slashes++; continue; }
                if (ch == '"') result.Append('\\', slashes * 2 + 1).Append(ch);
                else result.Append('\\', slashes).Append(ch);
                slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }

        public void Dispose() {
            if (handle != IntPtr.Zero) {
                CloseHandle(handle);
                handle = IntPtr.Zero;
            }
            GC.SuppressFinalize(this);
        }
        ~OwnedProcessJob() { Dispose(); }

        [StructLayout(LayoutKind.Sequential)] private struct BasicLimitInformation {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }
        [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimitInformation {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo {
            public uint cb;
            public string lpReserved, lpDesktop, lpTitle;
            public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }
        [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation {
            public IntPtr hProcess, hThread;
            public uint dwProcessId, dwThreadId;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimitInformation info, uint length);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")]
        private static extern bool CreateProcess(string applicationName, StringBuilder commandLine,
            IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags,
            IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    }
}
