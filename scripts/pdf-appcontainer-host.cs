// .NET Framework 4.x / C# 5; references: System.dll, System.Core.dll,
// System.Web.Extensions.dll. See docs/research/pdf-windows-sandbox.md.
// This file is a launcher, not a broker: never accept its configuration from a PDF.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

public static class PdfAppContainerHost
{
    const string HostFamily = "mcpvault-pdf-v1"; // Mutex namespace only; never a package identity.
    const int MaxOutput = 16 * 1024 * 1024;
    const uint CREATE_SUSPENDED = 0x4, CREATE_UNICODE_ENVIRONMENT = 0x400;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x80000, DETACHED_PROCESS = 0x8;
    // No console allocation/attachment. Explicit STARTF_USESTDHANDLES pipes are
    // independent of a console; all AppContainer/Job restrictions remain intact.
    const uint WorkerCreationFlags = CREATE_SUSPENDED | DETACHED_PROCESS | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT;
    const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8, JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100;
    const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const int PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x20002;
    const int PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x20009;
    const int PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY = 0x2000e;
    const uint PROCESS_CREATION_CHILD_PROCESS_RESTRICTED = 1;
    static readonly IntPtr InvalidHandle = new IntPtr(-1);
    sealed class Failure : Exception
    {
        internal readonly string Code;
        internal readonly int Exit;
        internal Failure(string code, int exit) { Code = code; Exit = exit; }
    }
    static void Require(bool condition, string code) { if (!condition) throw new Failure(code, 70); }
    static void Native(bool condition, string code) { if (!condition) throw new Failure(code, 71); }
    static JavaScriptSerializer Json() { return new JavaScriptSerializer { MaxJsonLength = MaxOutput, RecursionLimit = 32 }; }
    static void Emit(object value) { Console.WriteLine(Json().Serialize(value)); }

    // Public for csc Main and optional Add-Type callers; no Environment.Exit.
    public static int Main(string[] args)
    {
        try { return Run(args); }
        catch (Failure e) { Console.Error.WriteLine(e.Code); return e.Exit; }
        catch { Console.Error.WriteLine("sandbox_host_failed"); return 71; }
    }

    sealed class Config
    {
        internal readonly Dictionary<string, string> Options = new Dictionary<string, string>(StringComparer.Ordinal);
        internal readonly List<string> WorkerArgs = new List<string>();
        internal string Get(string key, string fallback) { string v; return Options.TryGetValue(key, out v) ? v : fallback; }
        internal bool Has(string key) { return Options.ContainsKey(key); }
        internal string Required(string key) { Require(Has(key), "invalid_arguments"); return Options[key]; }
        internal int Number(string key, int fallback, int min, int max)
        {
            int value;
            Require(Int32.TryParse(Get(key, fallback.ToString(CultureInfo.InvariantCulture)), NumberStyles.None,
                CultureInfo.InvariantCulture, out value) && value >= min && value <= max, "invalid_arguments");
            return value;
        }
        internal Config(string[] args)
        {
            var values = new HashSet<string>(new[] { "--profile", "--python", "--worker", "--runtime-root", "--job-dir", "--models",
                "--max-memory-mb", "--timeout-seconds", "--provision-runtime", "--provision-job", "--probe-file", "--probe-ip", "--probe-port" });
            var flags = new HashSet<string>(new[] { "--create-profile", "--delete-profile", "--self-test", "--contract-self-test" });
            Require(args != null && args.Length <= 64, "invalid_arguments");
            for (int i = 0; i < args.Length; i++)
            {
                string key = args[i];
                if (key == "--") { for (i++; i < args.Length; i++) WorkerArgs.Add(args[i]); break; }
                Require(!Options.ContainsKey(key) && (values.Contains(key) || flags.Contains(key)), "invalid_arguments");
                if (flags.Contains(key)) Options.Add(key, "true");
                else { Require(++i < args.Length && args[i].Length > 0, "invalid_arguments"); Options.Add(key, args[i]); }
            }
        }
        internal void Only(params string[] names)
        {
            var allowed = new HashSet<string>(names);
            foreach (string key in Options.Keys) Require(allowed.Contains(key), "invalid_arguments");
        }
    }

    static int Run(string[] args)
    {
        Config c = new Config(args);
        if (c.Has("--contract-self-test"))
        {
            c.Only("--contract-self-test"); Require(c.WorkerArgs.Count == 0, "invalid_arguments");
            ContractTests(); Emit(new { version = 1, contractTests = "passed", isolationTested = false }); return 0;
        }
        string profile = ValidateProfile(c.Required("--profile"));
        Require(Environment.OSVersion.Platform == PlatformID.Win32NT && IntPtr.Size == 8, "windows_x64_required");
        if (c.Has("--create-profile"))
        {
            c.Only("--create-profile", "--profile"); Require(c.WorkerArgs.Count == 0, "invalid_arguments");
            IntPtr created = IntPtr.Zero;
            try
            {
                int hr = CreateAppContainerProfile(profile, profile, "Local data-only PDF worker", IntPtr.Zero, 0, out created);
                Require(hr != unchecked((int)0x800700b7), "profile_already_exists");
                Native(hr == 0 && created != IntPtr.Zero, "profile_create_failed");
                Emit(new { version = 1, profile = profile, profileCreated = true }); return 0;
            }
            finally { if (created != IntPtr.Zero) FreeSid(created); }
        }
        if (c.Has("--delete-profile"))
        {
            c.Only("--delete-profile", "--profile"); Require(c.WorkerArgs.Count == 0, "invalid_arguments");
            // Node must already have confirmed process exit and serialized the entire lifecycle.
            // Also reject deletion while any launch through this host holds the account-wide lock.
            using (var mutex = new Mutex(false, "Global\\" + HostFamily + "-" + WindowsIdentity.GetCurrent().User.Value))
            {
                bool held = false;
                try
                {
                    try { held = mutex.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
                    Require(held, "sandbox_busy");
                    Native(DeleteAppContainerProfile(ValidateProfile(profile)) == 0, "profile_delete_failed");
                    Emit(new { version = 1, profile = profile, profileDeleted = true }); return 0;
                }
                finally { if (held) mutex.ReleaseMutex(); }
            }
        }
        using (var sid = new ContainerSid(profile))
        {
            if (c.Has("--provision-runtime") || c.Has("--provision-job")) return ProvisionPlan(c, profile, sid.Text);
            c.Only("--profile", "--python", "--worker", "--runtime-root", "--job-dir", "--models", "--max-memory-mb", "--timeout-seconds",
                "--self-test", "--probe-file", "--probe-ip", "--probe-port");
            sid.RequireProfile();
            int timeout = c.Number("--timeout-seconds", 120, 1, 3600);
            int memory = c.Number("--max-memory-mb", 1024, 64, 4096);
            string owner = WindowsIdentity.GetCurrent().User.Value;
            // Across sessions for this Windows account. No waiting behind another job.
            using (var mutex = new Mutex(false, "Global\\" + HostFamily + "-" + owner))
            {
                bool held = false;
                try
                {
                    try { held = mutex.WaitOne(0); } catch (AbandonedMutexException) { held = true; }
                    Require(held, "sandbox_busy");
                    using (var pins = new PathPins(timeout, owner, sid.Text))
                    {
                        string python = pins.Local(c.Required("--python"), false);
                        string runtime = pins.Dedicated(c.Get("--runtime-root", Path.GetDirectoryName(python)));
                        string worker = pins.Local(c.Required("--worker"), false);
                        string job = pins.Dedicated(c.Required("--job-dir"));
                        string models = c.Has("--models") ? pins.Dedicated(c.Required("--models")) : null;
                        Require(Under(python, runtime) && Under(worker, runtime), "runtime_path_invalid");
                        Require(!Overlap(runtime, job) && (models == null || (!Overlap(models, job) && !Overlap(models, runtime))), "roots_overlap");
                        pins.AuditTree(runtime, false, 32768);
                        if (models != null) pins.AuditTree(models, false, 4096);
                        pins.AuditTree(job, true, 4096);
                        List<string> child;
                        if (c.Has("--self-test"))
                        {
                            Require(c.WorkerArgs.Count == 0, "invalid_arguments");
                            child = DiagnosticArgs(c, pins, runtime, job, models, python);
                        }
                        else
                        {
                            Require(!c.Has("--probe-file") && !c.Has("--probe-ip") && !c.Has("--probe-port"), "invalid_arguments");
                            child = WorkerCommand(c.WorkerArgs, pins, worker, job, models, timeout);
                        }
                        Result result = Launch(python, child, runtime, job, memory, pins, sid.Pointer);
                        if (c.Has("--self-test")) return DiagnosticResult(result, profile);
                        // Only normal worker statuses may pass bytes to the Node schema validator.
                        if (!(result.ExitCode == 0 || (result.ExitCode >= 2 && result.ExitCode <= 5)))
                            throw new Failure("worker_abnormal_exit_" + result.ExitCode.ToString("x8", CultureInfo.InvariantCulture), 71);
                        if (result.Output.Length == 0) throw new Failure("worker_output_missing", 71);
                        Stream output = Console.OpenStandardOutput();
                        output.Write(result.Output, 0, result.Output.Length); output.Flush();
                        return (int)result.ExitCode;
                    }
                }
                finally { if (held) mutex.ReleaseMutex(); }
            }
        }
    }

    static string ValidateProfile(string profile)
    {
        Require(profile != null && Regex.IsMatch(profile, @"\Amcpvault-pdf-v1-[0-9a-f]{32}\z"), "invalid_profile");
        return profile;
    }
    static bool Under(string path, string root) { return path.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase); }
    static bool Overlap(string a, string b) { return String.Equals(a, b, StringComparison.OrdinalIgnoreCase) || Under(a, b) || Under(b, a); }
    // Deliberately stricter than Win32 normalization: no aliases, ADS, devices or dot segments.
    static string Canonical(string value)
    {
        Require(value != null && value.Length >= 4 && value.Length <= 240 && Regex.IsMatch(value, @"^[A-Za-z]:[\\/]"), "local_path_required");
        string p = value.Replace('/', '\\');
        string[] parts = p.Substring(3).Split('\\');
        foreach (string part in parts)
            Require(part.Length > 0 && part != "." && part != ".." && !part.EndsWith(".") && !part.EndsWith(" ") &&
                !Regex.IsMatch(part, "[\\x00-\\x1f<>:\"|?*~]") &&
                !Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)", RegexOptions.IgnoreCase), "local_path_required");
        Require(String.Equals(Path.GetFullPath(p), p, StringComparison.OrdinalIgnoreCase), "local_path_required");
        return p;
    }

    sealed class PathPins : IDisposable
    {
        readonly Dictionary<string, IntPtr> handles = new Dictionary<string, IntPtr>(StringComparer.OrdinalIgnoreCase);
        readonly Stopwatch watch = Stopwatch.StartNew();
        readonly int seconds;
        readonly string owner, container;
        internal PathPins(int timeout, string user, string sid) { seconds = timeout; owner = user; container = sid; }
        internal uint Remaining()
        {
            long left = seconds * 1000L - watch.ElapsedMilliseconds;
            if (left <= 0) throw new Failure("sandbox_timeout", 72);
            return (uint)Math.Min(left, UInt32.MaxValue - 1L);
        }
        internal string Local(string value, bool directory)
        {
            Remaining(); string path = Canonical(value);
            Require(new DriveInfo(Path.GetPathRoot(path)).DriveType == DriveType.Fixed, "fixed_local_volume_required");
            string cursor = Path.GetPathRoot(path);
            // Hold every directory against rename/delete until the process has exited.
            Pin(cursor, true, true);
            string[] parts = path.Substring(3).Split('\\');
            for (int i = 0; i < parts.Length; i++)
            {
                cursor = Path.Combine(cursor, parts[i]);
                Pin(cursor, i < parts.Length - 1 || directory, true);
            }
            return path;
        }
        void Pin(string path, bool directory, bool allowWriteShare)
        {
            Remaining();
            if (handles.ContainsKey(path)) return;
            IntPtr h = CreateFileW(path, 0x00020080, allowWriteShare ? 3u : 1u, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
            Native(h != InvalidHandle, "path_unavailable");
            try
            {
                BY_HANDLE_FILE_INFORMATION info;
                Native(GetFileInformationByHandle(h, out info), "path_inspection_failed");
                Require((info.FileAttributes & 0x400) == 0 && ((info.FileAttributes & 0x10) != 0) == directory, "reparse_or_path_type_rejected");
                Require(directory || info.NumberOfLinks == 1, "hardlink_rejected");
                var final = new StringBuilder(1024);
                uint length = GetFinalPathNameByHandleW(h, final, (uint)final.Capacity, 0);
                Native(length > 0 && length < final.Capacity, "path_inspection_failed");
                Require(String.Equals(final.ToString(), "\\\\?\\" + path, StringComparison.OrdinalIgnoreCase), "path_alias_rejected");
                handles.Add(path, h); h = IntPtr.Zero;
            }
            finally { Close(ref h); }
        }
        internal string Dedicated(string value)
        {
            string path = Local(value, true);
            Require(path.Substring(3).Split('\\').Length >= 2, "dedicated_root_required");
            foreach (Environment.SpecialFolder folder in new[] { Environment.SpecialFolder.UserProfile, Environment.SpecialFolder.Windows,
                Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.CommonApplicationData })
            {
                string protectedPath = Environment.GetFolderPath(folder).TrimEnd('\\');
                Require(protectedPath.Length == 0 || !(String.Equals(path, protectedPath, StringComparison.OrdinalIgnoreCase) || Under(protectedPath, path)), "broad_root_rejected");
                if (folder == Environment.SpecialFolder.Windows) Require(!Under(path, protectedPath), "broad_root_rejected");
            }
            return path;
        }
        internal void AuditTree(string root, bool writable, int limit)
        {
            var pending = new Stack<string>(); pending.Push(root); int count = 0;
            while (pending.Count != 0)
            {
                string path = pending.Pop(); Remaining();
                Require(++count <= limit, "acl_audit_budget_exceeded");
                FileAttributes attributes = File.GetAttributes(path);
                Require((attributes & FileAttributes.ReparsePoint) == 0, "reparse_or_path_type_rejected");
                bool directory = (attributes & FileAttributes.Directory) != 0;
                Local(path, directory);
                // An additional non-write-sharing file handle pins trusted code/model/input bytes.
                if (!directory)
                {
                    IntPtr immutable = CreateFileW(path, 0x80, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
                    Native(immutable != InvalidHandle, "file_not_quiescent");
                    handles.Add("locked:" + path, immutable);
                }
                FileSystemSecurity security = directory ? (FileSystemSecurity)Directory.GetAccessControl(path, AccessControlSections.Access | AccessControlSections.Owner)
                    : File.GetAccessControl(path, AccessControlSections.Access | AccessControlSections.Owner);
                string actualOwner = security.GetOwner(typeof(SecurityIdentifier)).Value;
                Require(actualOwner == owner || actualOwner == "S-1-5-18" || actualOwner == "S-1-5-32-544", "acl_owner_rejected");
                Require(path != root || security.AreAccessRulesProtected, "acl_root_not_protected");
                FileSystemRights granted = 0;
                foreach (FileSystemAccessRule ace in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
                {
                    string principal = ace.IdentityReference.Value;
                    Require(ace.AccessControlType == AccessControlType.Allow, "acl_not_baseline");
                    Require(principal == owner || principal == "S-1-5-18" || principal == "S-1-5-32-544" || principal == container, "acl_broad_principal_rejected");
                    if (principal == container)
                    {
                        FileSystemRights allowed = (writable ? FileSystemRights.Modify : FileSystemRights.ReadAndExecute) | FileSystemRights.Synchronize;
                        Require((ace.FileSystemRights & ~allowed) == 0, "acl_container_rights_rejected");
                        if ((ace.PropagationFlags & PropagationFlags.InheritOnly) == 0) granted |= ace.FileSystemRights;
                    }
                }
                FileSystemRights required = writable ? FileSystemRights.Modify : FileSystemRights.ReadAndExecute;
                Require((granted & required) == required, "acl_container_grant_missing");
                if (directory)
                    foreach (string entry in Directory.EnumerateFileSystemEntries(path))
                    {
                        Remaining(); Require(count + pending.Count < limit, "acl_audit_budget_exceeded"); pending.Push(entry);
                    }
            }
        }
        public void Dispose() { foreach (IntPtr h in handles.Values) CloseHandle(h); handles.Clear(); }
    }

    static List<string> WorkerCommand(List<string> input, PathPins pins, string worker, string job, string models, int timeout)
    {
        var result = new List<string> { "-I", "-B", worker };
        var seen = new HashSet<string>(); bool check = false, hasInput = false, enrichment = false, manifest = false;
        for (int i = 0; i < input.Count; i++)
        {
            string key = input[i]; Require(seen.Add(key), "invalid_worker_arguments");
            if (key == "--check" || key == "--layout")
            {
                if (key == "--check") check = true; else enrichment = true;
                result.Add(key); continue;
            }
            Require(++i < input.Count, "invalid_worker_arguments"); string v = input[i];
            switch (key)
            {
                case "--input": v = pins.Local(v, false); Require(Under(v, job) && new FileInfo(v).Length <= 50L * 1024 * 1024, "input_path_rejected"); hasInput = true; break;
                case "--model-manifest":
                    v = pins.Local(v, false); Require(models != null && Under(v, models), "model_path_rejected");
                    Require(new FileInfo(v).Length <= 128 * 1024, "model_manifest_rejected");
                    var m = Json().DeserializeObject(File.ReadAllText(v, Encoding.UTF8)) as Dictionary<string, object>;
                    Require(m != null && m.ContainsKey("artifactsRoot") && m["artifactsRoot"] is string, "model_manifest_rejected");
                    string artifacts = pins.Local((string)m["artifactsRoot"], true);
                    Require(Under(artifacts, models) && !Under(v, artifacts), "model_path_rejected"); manifest = true; break;
                case "--output-json": Require(v == "stdout", "invalid_worker_arguments"); break;
                case "--max-pages": BoundedInteger(v, 1, 200); break;
                case "--timeout-seconds":
                    double seconds;
                    Require(Double.TryParse(v, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out seconds) && seconds > 0 && seconds <= timeout, "invalid_worker_arguments"); break;
                case "--pages":
                    Require(Regex.IsMatch(v, @"^[0-9]{1,3}(,[0-9]{1,3}){0,199}$"), "invalid_worker_arguments");
                    foreach (string page in v.Split(',')) BoundedInteger(page, 1, 200); break;
                case "--ocr": Require(v == "off" || v == "rapidocr", "invalid_worker_arguments"); enrichment |= v == "rapidocr"; break;
                case "--expected-sha256": Require(Regex.IsMatch(v, "^[a-f0-9]{64}$"), "invalid_worker_arguments"); break;
                default: throw new Failure("invalid_worker_arguments", 70);
            }
            result.Add(key); result.Add(v);
        }
        Require(check != hasInput && (!enrichment || manifest), "invalid_worker_arguments");
        // Broker-owned roots only: the input allowlist above MUST NOT accept
        // these flags. PathPins already checked every canonical ancestor and
        // holds them through child exit; the lowbox only inspects its grants.
        result.Add("--trusted-input-root"); result.Add(job);
        if (models != null) { result.Add("--trusted-model-root"); result.Add(models); }
        return result;
    }
    static int BoundedInteger(string value, int min, int max)
    {
        int n; Require(Int32.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out n) && n >= min && n <= max, "invalid_worker_arguments"); return n;
    }

    // Correct CRT/CommandLineToArgvW-compatible quoting; CreateProcess gets lpApplicationName separately.
    public static string QuoteArgument(string argument)
    {
        Require(argument != null && argument.IndexOf('\0') < 0, "invalid_arguments");
        var text = new StringBuilder("\""); int slashes = 0;
        foreach (char ch in argument)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { text.Append('\\', slashes * 2 + 1); text.Append(ch); }
            else { text.Append('\\', slashes); text.Append(ch); }
            slashes = 0;
        }
        text.Append('\\', slashes * 2); return text.Append('"').ToString();
    }
    static string CommandLine(string python, List<string> args)
    {
        var text = new StringBuilder(QuoteArgument(python));
        foreach (string value in args) text.Append(' ').Append(QuoteArgument(value));
        Require(text.Length < 30000, "command_line_budget_exceeded"); return text.ToString();
    }
    static string EnvironmentBlock(string runtime, string job)
    {
        var windows = new StringBuilder(512); uint length = GetWindowsDirectoryW(windows, (uint)windows.Capacity);
        Native(length > 0 && length < windows.Capacity, "windows_directory_failed");
        string win = windows.ToString();
        var env = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            { "SystemRoot", win }, { "windir", win },
            { "PATH", runtime + ";" + Path.Combine(runtime, "DLLs") + ";" + Path.Combine(win, "System32") },
            { "TEMP", job }, { "TMP", job }, { "HOME", job }, { "USERPROFILE", job },
            { "LOCALAPPDATA", job }, { "APPDATA", job },
            { "HF_HOME", Path.Combine(job, "hf") }, { "TORCH_HOME", Path.Combine(job, "torch") },
            // Torch's import-time Dynamo cache otherwise calls getpass.getuser.
            // Keep it inside the fresh job without inheriting host identity/cache.
            { "TORCHINDUCTOR_CACHE_DIR", Path.Combine(job, "torchinductor") },
            { "XDG_CACHE_HOME", Path.Combine(job, "cache") },
            { "HF_HUB_OFFLINE", "1" }, { "TRANSFORMERS_OFFLINE", "1" }, { "HF_DATASETS_OFFLINE", "1" },
            { "HF_HUB_DISABLE_TELEMETRY", "1" }, { "DO_NOT_TRACK", "1" }, { "TOKENIZERS_PARALLELISM", "false" },
            { "OMP_NUM_THREADS", "2" }, { "MKL_NUM_THREADS", "2" }, { "OPENBLAS_NUM_THREADS", "2" },
            { "NUMEXPR_NUM_THREADS", "2" }, { "VECLIB_MAXIMUM_THREADS", "2" }
        };
        var block = new StringBuilder(); foreach (var pair in env) block.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
        return block.Append('\0').ToString();
    }

    sealed class ContainerSid : IDisposable
    {
        internal IntPtr Pointer;
        internal string Text;
        internal ContainerSid(string profile)
        {
            int hr = DeriveAppContainerSidFromAppContainerName(ValidateProfile(profile), out Pointer);
            if (hr != 0 || Pointer == IntPtr.Zero) { Dispose(); throw new Failure("profile_sid_failed", 71); }
            try { Text = new SecurityIdentifier(Pointer).Value; } catch { Dispose(); throw; }
        }
        internal void RequireProfile()
        {
            IntPtr folder = IntPtr.Zero;
            try
            {
                int hr = GetAppContainerFolderPath(Text, out folder);
                Require(hr == 0 && folder != IntPtr.Zero && Directory.Exists(Marshal.PtrToStringUni(folder)), "profile_not_provisioned");
            }
            finally { if (folder != IntPtr.Zero) Marshal.FreeCoTaskMem(folder); }
        }
        public void Dispose() { if (Pointer != IntPtr.Zero) { FreeSid(Pointer); Pointer = IntPtr.Zero; } }
    }

    sealed class Attributes : IDisposable
    {
        internal IntPtr List;
        readonly List<IntPtr> allocated = new List<IntPtr>();
        bool initialized;
        internal Attributes()
        {
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 3, 0, ref size);
            Native(size.ToInt64() > 0 && size.ToInt64() < 65536, "attribute_list_failed");
            List = Marshal.AllocHGlobal(size);
            try { Native(InitializeProcThreadAttributeList(List, 3, 0, ref size), "attribute_list_failed"); initialized = true; }
            catch { Dispose(); throw; }
        }
        internal void Add(int key, object value)
        {
            int bytes = Marshal.SizeOf(value); IntPtr p = Marshal.AllocHGlobal(bytes); allocated.Add(p);
            Marshal.StructureToPtr(value, p, false); AddPointer(key, p, bytes);
        }
        internal void Handles(IntPtr input, IntPtr output, IntPtr error)
        {
            IntPtr p = Marshal.AllocHGlobal(3 * IntPtr.Size); allocated.Add(p);
            Marshal.WriteIntPtr(p, 0, input); Marshal.WriteIntPtr(p, IntPtr.Size, output); Marshal.WriteIntPtr(p, 2 * IntPtr.Size, error);
            AddPointer(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, p, 3 * IntPtr.Size);
        }
        void AddPointer(int key, IntPtr p, int bytes)
        {
            Native(UpdateProcThreadAttribute(List, 0, new IntPtr(key), p, new IntPtr(bytes), IntPtr.Zero, IntPtr.Zero), "process_attribute_failed");
        }
        public void Dispose()
        {
            if (List != IntPtr.Zero) { if (initialized) DeleteProcThreadAttributeList(List); Marshal.FreeHGlobal(List); List = IntPtr.Zero; }
            foreach (IntPtr p in allocated) Marshal.FreeHGlobal(p); allocated.Clear();
        }
    }

    sealed class Result { internal byte[] Output; internal uint ExitCode; }
#if PDF_HOST_DIAGNOSTICS
    // Explicitly compiled operator-only diagnostic variant. Not present in the
    // production executable and never enabled by MCP/environment configuration.
    // The child is already assigned to the unchanged Job and token-verified.
    // Only a data-free --check may wait, with the original absolute deadline.
    static void WaitForApprovedDebugger(IntPtr process, uint processId, PathPins clock)
    {
        Console.Error.WriteLine("pdf_debug_pid_" + processId.ToString(CultureInfo.InvariantCulture));
        var wait = Stopwatch.StartNew();
        while (true)
        {
            clock.Remaining();
            bool attached;
            Native(CheckRemoteDebuggerPresent(process, out attached), "debugger_query_failed");
            if (attached) return;
            Native(wait.ElapsedMilliseconds < 60000, "debugger_attach_timeout");
            Thread.Sleep(20);
        }
    }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CheckRemoteDebuggerPresent(IntPtr process, [MarshalAs(UnmanagedType.Bool)] out bool attached);
#endif
    static Result Launch(string python, List<string> args, string runtime, string directory, int memory, PathPins clock, IntPtr sid)
    {
        IntPtr job = IntPtr.Zero, input = IntPtr.Zero, inputWriter = IntPtr.Zero;
        IntPtr output = IntPtr.Zero, outputWriter = IntPtr.Zero, error = IntPtr.Zero, environment = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION(); bool assigned = false, finished = false;
        try
        {
            clock.Remaining();
            job = CreateJobObjectW(IntPtr.Zero, null); Native(job != IntPtr.Zero, "job_create_failed");
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY |
                JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            limits.BasicLimitInformation.ActiveProcessLimit = 1;
            limits.ProcessMemoryLimit = new UIntPtr((ulong)memory * 1024 * 1024);
            limits.JobMemoryLimit = limits.ProcessMemoryLimit;
            Native(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)), "job_limits_failed");
            uint ui = 0xff; Native(SetJobUiLimits(job, 4, ref ui, 4), "job_ui_limits_failed");
            var sa = new SECURITY_ATTRIBUTES { Length = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), InheritHandle = true };
            Native(CreatePipe(out input, out inputWriter, ref sa, 0), "stdin_pipe_failed");
            // Never inherit a writable stdin endpoint. EOF is immediate, including on launch failure.
            Close(ref inputWriter);
            Native(CreatePipe(out output, out outputWriter, ref sa, 0), "stdout_pipe_failed");
            Native(SetHandleInformation(output, 1, 0), "pipe_inheritance_failed");
            error = CreateFileInherited("NUL", 0x40000000, 3, ref sa, 3, 0x80, IntPtr.Zero);
            Native(error != InvalidHandle, "stderr_sink_failed");
            using (var attributes = new Attributes())
            {
                attributes.Add(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, new SECURITY_CAPABILITIES {
                    AppContainerSid = sid, Capabilities = IntPtr.Zero, CapabilityCount = 0, Reserved = 0 });
                attributes.Add(PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY, PROCESS_CREATION_CHILD_PROCESS_RESTRICTED);
                attributes.Handles(input, outputWriter, error);
                var startup = new STARTUPINFOEX(); startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
                startup.StartupInfo.dwFlags = 0x100; // STARTF_USESTDHANDLES
                startup.StartupInfo.hStdInput = input; startup.StartupInfo.hStdOutput = outputWriter; startup.StartupInfo.hStdError = error;
                startup.AttributeList = attributes.List;
                environment = Marshal.StringToHGlobalUni(EnvironmentBlock(runtime, directory));
                var command = new StringBuilder(CommandLine(python, args), 32768);
                clock.Remaining();
                Native(CreateProcessW(python, command, IntPtr.Zero, IntPtr.Zero, true,
                    WorkerCreationFlags,
                    environment, directory, ref startup, out process), "appcontainer_create_failed");
                Close(ref input); Close(ref outputWriter); Close(ref error);
                // Absolutely no resume/fallback if assignment or token verification fails.
                Native(AssignProcessToJobObject(job, process.Process), "job_attach_failed"); assigned = true;
                bool inJob; Native(IsProcessInJob(process.Process, job, out inJob) && inJob, "job_membership_failed");
                VerifyToken(process.Process, sid);
                clock.Remaining();
#if PDF_HOST_DIAGNOSTICS
                Require(args.Contains("--check"), "diagnostic_requires_data_free_check");
                WaitForApprovedDebugger(process.Process, process.ProcessId, clock);
                // CDB -pr owns resumption after attachment in this explicit
                // diagnostic build; a second ResumeThread races debugger state.
#else
                Native(ResumeThread(process.Thread) == 1, "process_resume_failed");
#endif
                Close(ref process.Thread);
            }
            using (var bytes = new MemoryStream())
            {
                byte[] chunk = new byte[64 * 1024];
                while (true)
                {
                    clock.Remaining();
                    uint available;
                    if (!PeekNamedPipe(output, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero))
                    {
                        Native(Marshal.GetLastWin32Error() == 109, "stdout_read_failed");
                        available = 0;
                    }
                    if (available > 0)
                    {
                        if (bytes.Length + available > MaxOutput) throw new Failure("sandbox_output_exceeded", 73);
                        uint read;
                        Native(ReadFile(output, chunk, Math.Min(available, (uint)chunk.Length), out read, IntPtr.Zero) && read > 0, "stdout_read_failed");
                        bytes.Write(chunk, 0, (int)read); continue;
                    }
                    uint state = WaitForSingleObject(process.Process, Math.Min(clock.Remaining(), 10u));
                    Native(state == 0 || state == 258, "process_wait_failed");
                    if (state == 0)
                    {
                        // One final drain AFTER process exit (the previous peek may have raced its last write).
                        uint remaining;
                        if (PeekNamedPipe(output, IntPtr.Zero, 0, IntPtr.Zero, out remaining, IntPtr.Zero))
                        { if (remaining > 0) continue; }
                        else Native(Marshal.GetLastWin32Error() == 109, "stdout_read_failed");
                        uint code; Native(GetExitCodeProcess(process.Process, out code), "process_exit_query_failed");
                        finished = true; return new Result { Output = bytes.ToArray(), ExitCode = code };
                    }
                }
            }
        }
        finally
        {
            // Close of the only job handle is also the crash/host-kill backstop.
            if (!finished && assigned && job != IntPtr.Zero) TerminateJobObject(job, 71);
            // A still-suspended process not attached to the job must not be orphaned.
            if (!finished && process.Process != IntPtr.Zero) TerminateProcess(process.Process, 71);
            Close(ref job);
            if (!finished && process.Process != IntPtr.Zero) WaitForSingleObject(process.Process, 2000);
            Close(ref process.Thread); Close(ref process.Process);
            Close(ref input); Close(ref inputWriter); Close(ref output); Close(ref outputWriter); Close(ref error);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        }
    }

    static IntPtr TokenInfo(IntPtr token, int kind)
    {
        int needed; GetTokenInformation(token, kind, IntPtr.Zero, 0, out needed);
        Require(needed > 0 && needed <= 65536, "token_query_failed"); IntPtr info = Marshal.AllocHGlobal(needed);
        try { Native(GetTokenInformation(token, kind, info, needed, out needed), "token_query_failed"); return info; }
        catch { Marshal.FreeHGlobal(info); throw; }
    }
    static void VerifyToken(IntPtr process, IntPtr expectedSid)
    {
        IntPtr token = IntPtr.Zero;
        try
        {
            Native(OpenProcessToken(process, 0x8, out token), "token_open_failed");
            IntPtr info = TokenInfo(token, 29); // TokenIsAppContainer
            try { Require(Marshal.ReadInt32(info) == 1, "token_not_appcontainer"); } finally { Marshal.FreeHGlobal(info); }
            info = TokenInfo(token, 30); // TokenCapabilities (TOKEN_GROUPS.GroupCount)
            try { Require(Marshal.ReadInt32(info) == 0, "token_capabilities_rejected"); } finally { Marshal.FreeHGlobal(info); }
            info = TokenInfo(token, 31); // TokenAppContainerSid
            try { Require(EqualSid(Marshal.ReadIntPtr(info), expectedSid), "token_container_mismatch"); } finally { Marshal.FreeHGlobal(info); }
            info = TokenInfo(token, 25); // TokenIntegrityLevel / TOKEN_MANDATORY_LABEL
            try
            {
                string label = new SecurityIdentifier(Marshal.ReadIntPtr(info)).Value;
                Require(label == "S-1-16-4096", "token_integrity_rejected");
            }
            finally { Marshal.FreeHGlobal(info); }
        }
        finally { Close(ref token); }
    }

    static List<string> DiagnosticArgs(Config c, PathPins pins, string runtime, string job, string models, string python)
    {
        string probe = pins.Local(c.Required("--probe-file"), false);
        Require(!Under(probe, runtime) && !Under(probe, job) && (models == null || !Under(probe, models)), "probe_file_not_private");
        // Host positive control: opening succeeds, but contents are neither read nor returned.
        using (var stream = new FileStream(probe, FileMode.Open, FileAccess.Read, FileShare.Read)) { }
        IPAddress ip; Require(IPAddress.TryParse(c.Required("--probe-ip"), out ip) && ip.AddressFamily == AddressFamily.InterNetwork &&
            !IPAddress.IsLoopback(ip) && !ip.Equals(IPAddress.Any) && !ip.Equals(IPAddress.Broadcast), "probe_ipv4_required");
        int port = c.Number("--probe-port", 0, 1, 65535);
        // Explicit diagnostic mode only. Operator owns this destination; no PDF bytes are sent.
        using (var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp))
        {
            IAsyncResult attempt = socket.BeginConnect(ip, port, null, null);
            using (WaitHandle wait = attempt.AsyncWaitHandle)
            {
                Require(wait.WaitOne((int)Math.Min(pins.Remaining(), 3000u)), "probe_host_connect_unavailable");
                try { socket.EndConnect(attempt); } catch { throw new Failure("probe_host_connect_unavailable", 74); }
            }
        }
        // Deliberately does NOT import the PDF worker/socket monkeypatch. This is actual OS denial evidence.
        const string probeCode =
            "import os,sys,socket,json,subprocess,ctypes\nfrom ctypes import wintypes as wt\n" +
            "k=ctypes.WinDLL('kernel32',use_last_error=True)\n" +
            "k.CreateFileW.argtypes=[wt.LPCWSTR,wt.DWORD,wt.DWORD,wt.LPVOID,wt.DWORD,wt.DWORD,wt.HANDLE]; k.CreateFileW.restype=wt.HANDLE\n" +
            "k.CloseHandle.argtypes=[wt.HANDLE]; k.CloseHandle.restype=wt.BOOL\n" +
            "def err_open(path,access):\n" +
            " h=k.CreateFileW(path,access,3,None,3,128,None)\n" +
            " if h==ctypes.c_void_p(-1).value: return ctypes.get_last_error()\n" +
            " k.CloseHandle(h); return 0\n" +
            "f=err_open(sys.argv[1],1)\n" +
            "w=err_open(sys.argv[4],2)\n" +
            "s=socket.socket(socket.AF_INET,socket.SOCK_STREAM); s.settimeout(2)\n" +
            "try: n=s.connect_ex((sys.argv[2],int(sys.argv[3])))\n" +
            "except OSError as e: n=e.winerror or e.errno\n" +
            "finally: s.close()\n" +
            "try:\n p=subprocess.Popen([sys.executable,'-I','-B','-c','pass'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); p.wait(timeout=2); c=0\n" +
            "except OSError as e: c=e.winerror or e.errno\n" +
            "except Exception: c=-1\n" +
            "e=(os.read(0,1)==b'')\n" +
            "r={'networkError':n,'privateReadError':f,'runtimeWriteError':w,'childError':c,'stdinEof':e}\n" +
            "print(json.dumps(r,separators=(',',':')))\n";
        return new List<string> { "-I", "-B", "-c", probeCode, probe, ip.ToString(), port.ToString(CultureInfo.InvariantCulture), python };
    }
    static int DiagnosticResult(Result result, string profile)
    {
        Require(result.ExitCode == 0 && result.Output.Length <= 4096, "sandbox_diagnostic_failed");
        var data = Json().DeserializeObject(new UTF8Encoding(false, true).GetString(result.Output)) as Dictionary<string, object>;
        Require(data != null && data.Count == 5, "sandbox_diagnostic_failed");
        foreach (string name in new[] { "networkError", "privateReadError", "runtimeWriteError", "childError", "stdinEof" })
            Require(data.ContainsKey(name), "sandbox_diagnostic_failed");
        int net = Convert.ToInt32(data["networkError"], CultureInfo.InvariantCulture);
        int read = Convert.ToInt32(data["privateReadError"], CultureInfo.InvariantCulture);
        int write = Convert.ToInt32(data["runtimeWriteError"], CultureInfo.InvariantCulture);
        int child = Convert.ToInt32(data["childError"], CultureInfo.InvariantCulture);
        bool eof = data["stdinEof"] is bool && (bool)data["stdinEof"];
        bool passed = DiagnosticDenied(net, read, write, child, eof);
        Emit(new { version = 1, sandbox = profile, passed = passed, tokenVerifiedBeforeResume = true,
            hostReadSucceeded = true, hostConnectSucceeded = true, networkError = net,
            privateReadError = read, runtimeWriteError = write, childError = child, stdinEof = eof });
        return passed ? 0 : 74;
    }
    static bool DiagnosticDenied(int net, int read, int write, int child, bool eof)
    {
        // ERROR_CHILD_PROCESS_BLOCKED (367) specifically identifies the child
        // restriction policy. A timeout/refusal is never network-denial proof.
        return net == 10013 && read == 5 && write == 5 && (child == 5 || child == 367) && eof;
    }

    static int ProvisionPlan(Config c, string profile, string sid)
    {
        c.Only("--profile", "--provision-runtime", "--provision-job", "--models");
        Require(c.WorkerArgs.Count == 0 && c.Has("--provision-runtime") != c.Has("--provision-job") &&
            (!c.Has("--provision-job") || !c.Has("--models")), "invalid_arguments");
        string user = WindowsIdentity.GetCurrent().User.Value;
        using (var pins = new PathPins(120, user, sid))
        {
            bool writable = c.Has("--provision-job");
            string root = pins.Dedicated(c.Required(writable ? "--provision-job" : "--provision-runtime"));
            string models = c.Has("--models") ? pins.Dedicated(c.Required("--models")) : null;
            Require(models == null || !Overlap(root, models), "roots_overlap");
            // Reviewable DACL templates only; no SetAcl, icacls or process invocation here.
            var plans = new List<object>();
            plans.Add(AclPlan(root, writable, user, sid));
            if (models != null) plans.Add(AclPlan(models, false, user, sid));
            Emit(new { version = 1, profile = profile, containerSid = sid, applied = false,
                warning = "Replace DACLs only on reviewed dedicated trees; reject links first; never apply to a home, repository, Vault or drive root.",
                roots = plans }); return 0;
        }
    }
    static object AclPlan(string root, bool writable, string user, string sid)
    {
        string rights = writable ? "0x1301bf" : "0x1200a9"; // Modify | Synchronize / ReadAndExecute | Synchronize
        string directory = "O:" + user + "D:P(A;OICI;FA;;;" + user + ")(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;" + rights + ";;;" + sid + ")";
        string file = "O:" + user + "D:P(A;;FA;;;" + user + ")(A;;FA;;;SY)(A;;FA;;;BA)(A;;" + rights + ";;;" + sid + ")";
        return new { path = root, containerAccess = writable ? "Modify" : "ReadAndExecute", directorySddl = directory, fileSddl = file,
            applyWith = "Operator: validate every existing descendant is local, not reparse/hardlinked; use DirectorySecurity/FileSecurity.SetSecurityDescriptorSddlForm(sddl, Access|Owner) and Set-Acl -LiteralPath for each. This replaces, not merges, the DACL.",
            integrityCommand = writable ? new { executable = "icacls.exe", argv = new[] { root, "/setintegritylevel", "(OI)(CI)L", "/T" } } : null };
    }

    static void ContractTests()
    {
        string inheritedCache = Environment.GetEnvironmentVariable("TORCHINDUCTOR_CACHE_DIR");
        try
        {
            Environment.SetEnvironmentVariable("TORCHINDUCTOR_CACHE_DIR", @"C:\host-private-cache");
            string environment = EnvironmentBlock(@"C:\runtime", @"C:\private\job");
            Require(environment.Contains("TORCHINDUCTOR_CACHE_DIR=C:\\private\\job\\torchinductor\0") &&
                !environment.Contains("host-private-cache") && !environment.Contains("USERNAME="),
                "contract_private_torch_cache_failed");
        }
        finally { Environment.SetEnvironmentVariable("TORCHINDUCTOR_CACHE_DIR", inheritedCache); }
        Require(DiagnosticDenied(10013, 5, 5, 367, true) && DiagnosticDenied(10013, 5, 5, 5, true) &&
            !DiagnosticDenied(10035, 5, 5, 367, true) && !DiagnosticDenied(10061, 5, 5, 367, true) &&
            !DiagnosticDenied(10013, 0, 5, 367, true) && !DiagnosticDenied(10013, 5, 0, 367, true) &&
            !DiagnosticDenied(10013, 5, 32, 367, true) && !DiagnosticDenied(10013, 5, 5, 123, true) &&
            !DiagnosticDenied(10013, 5, 5, -1, true) &&
            !DiagnosticDenied(10013, 5, 5, 0, true) && !DiagnosticDenied(10013, 5, 5, 367, false), "contract_diagnostic_denials_failed");
        var checkedArgs = WorkerCommand(new List<string> { "--check" }, null, @"C:\runtime\worker.py", @"C:\private\job", @"C:\private\models", 120);
        Require(checkedArgs[checkedArgs.IndexOf("--trusted-input-root") + 1] == @"C:\private\job" &&
            checkedArgs[checkedArgs.IndexOf("--trusted-model-root") + 1] == @"C:\private\models", "contract_broker_roots_failed");
        foreach (string injected in new[] { "--trusted-input-root", "--trusted-model-root", "--trusted-input-root=C:\\evil", "--trusted-model-root=C:\\evil", "--trusted-input", "--trusted-model" })
        {
            bool denied = false;
            try { WorkerCommand(new List<string> { "--check", injected, @"C:\evil" }, null, "worker", "job", null, 120); }
            catch (Failure) { denied = true; }
            Require(denied, "contract_broker_root_injection_failed");
        }
        // The worker uses only explicit inherited pipes, never a console. In a
        // lowbox, hidden-console allocation may fail before Python can execute.
        Require((WorkerCreationFlags & 0x8) != 0 && (WorkerCreationFlags & 0x08000010) == 0 &&
            (WorkerCreationFlags & (CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT)) ==
            (CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT), "contract_detached_worker_failed");
        string fresh = "mcpvault-pdf-v1-0123456789abcdef0123456789abcdef";
        Require(ValidateProfile(fresh) == fresh, "contract_profile_failed");
        foreach (string invalid in new[] { "mcpvault-pdf-v1", "", fresh.ToUpperInvariant(), fresh + "\n",
            fresh + "0", fresh.Substring(0, fresh.Length - 1), "other-0123456789abcdef0123456789abcdef" })
        {
            bool denied = false; try { ValidateProfile(invalid); } catch (Failure) { denied = true; }
            Require(denied, "contract_profile_failed");
        }
        bool missing = false;
        try { new Config(new[] { "--create-profile" }).Required("--profile"); } catch (Failure) { missing = true; }
        Require(missing, "contract_profile_required_failed");
        Require(new Config(new[] { "--delete-profile", "--profile", fresh }).Required("--profile") == fresh, "contract_delete_arguments_failed");
        string[] cases = { "", "plain", "a b", "a\"b", "C:\\dir with spaces\\", "a\\\"b", "한글 & % PATH" };
        foreach (string sample in cases)
        {
            int count; IntPtr array = CommandLineToArgvW("host " + QuoteArgument(sample), out count);
            try { Require(array != IntPtr.Zero && count == 2 && Marshal.PtrToStringUni(Marshal.ReadIntPtr(array, IntPtr.Size)) == sample, "contract_quote_failed"); }
            finally { if (array != IntPtr.Zero) LocalFree(array); }
        }
        foreach (string invalid in new[] { @"\\server\share\a", @"C:relative", @"C:\a\..\b", @"C:\a\x:stream", @"C:\a\NUL.txt", @"C:\a\tail.", @"C:\a\SHORT~1" })
        {
            bool denied = false; try { Canonical(invalid); } catch (Failure) { denied = true; }
            Require(denied, "contract_path_failed");
        }
        Require(Canonical(@"C:/dedicated/python/python.exe") == @"C:\dedicated\python\python.exe", "contract_path_failed");
        Require(Under(@"C:\runtime\python.exe", @"C:\runtime") && !Under(@"C:\runtime-evil\python.exe", @"C:\runtime"), "contract_containment_failed");
        Require(Marshal.SizeOf(typeof(STARTUPINFOEX)) == 112 && Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)) == 24 &&
            Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)) == 144, "contract_x64_layout_failed");
    }

    static void Close(ref IntPtr handle)
    {
        if (handle != IntPtr.Zero && handle != InvalidHandle) CloseHandle(handle);
        handle = IntPtr.Zero;
    }
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES
    { internal int Length; internal IntPtr SecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] internal bool InheritHandle; }
    [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES
    { internal IntPtr AppContainerSid, Capabilities; internal uint CapabilityCount, Reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO
    {
        internal int cb; internal IntPtr lpReserved, lpDesktop, lpTitle;
        internal uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        internal ushort wShowWindow, cbReserved2; internal IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX
    { internal STARTUPINFO StartupInfo; internal IntPtr AttributeList; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION
    { internal IntPtr Process, Thread; internal uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        internal long PerProcessUserTimeLimit, PerJobUserTimeLimit; internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; internal uint ActiveProcessLimit;
        internal UIntPtr Affinity; internal uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS
    { internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; internal IO_COUNTERS IoInfo;
        internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)] struct BY_HANDLE_FILE_INFORMATION
    {
        internal uint FileAttributes; internal System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
        internal uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern int DeleteAppContainerProfile(string name);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern int GetAppContainerFolderPath(string sid, out IntPtr path);
    [DllImport("advapi32.dll", ExactSpelling = true)] static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll", ExactSpelling = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool EqualSid(IntPtr a, IntPtr b);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr info, int size, out int needed);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] static extern bool CreateProcessW(string application, StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags,
        IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr bytes);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr key, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits, uint size);
    [DllImport("kernel32.dll", EntryPoint = "SetInformationJobObject", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SetJobUiLimits(IntPtr job, int kind, ref uint limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool IsProcessInJob(IntPtr process, IntPtr job, [MarshalAs(UnmanagedType.Bool)] out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool PeekNamedPipe(IntPtr pipe, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr left);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool ReadFile(IntPtr file, byte[] buffer, uint size, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern IntPtr CreateFileInherited(string path, uint access, uint share, ref SECURITY_ATTRIBUTES attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetFileInformationByHandle(IntPtr file, out BY_HANDLE_FILE_INFORMATION info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(IntPtr file, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern uint GetWindowsDirectoryW(StringBuilder buffer, uint size);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
}
