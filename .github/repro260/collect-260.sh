#!/usr/bin/env bash
# issue-260 一键取证脚本（临时，用完可删）
#
# 用法：
#   1) 下载本脚本到任意临时目录，chmod +x
#   2) ./collect-260.sh /opt/dsh-next/dsh-desktop-next ~/.cache/dsh-repro/home
#      第 1 个参数是 DSH NEXT 主程序；第 2 个参数是你正常复现时用的那份「隔离 home」。
#      请先按你原来的流程把 last-home 指向副本（你现有脚本会做），避免弹「数据目录已更改」对话框。
#   3) 等它打印 "DONE: /tmp/issue260-*/evidence.tar.gz"，把那个 tar.gz 发回 issue
#
# 它会：用 LD_PRELOAD 在宿主进程内部抓 ppoll/poll 的调用栈（不需要 ptrace），
# 在第 8/10/12/14/16/18/20 秒探测宿主端口，并导出一份健康/卡死现场（maps、fd、线程、
# 子进程、环境变量过滤、桌面壳日志尾部）。不会修改你的数据：只用 DSH_DESKTOP_NEXT_HOME 指向的 home。

set -u
APP="${1:?用法: collect-260.sh <DSH NEXT 可执行文件> <隔离 home>}"
HOME_DIR="${2:?用法: collect-260.sh <DSH NEXT 可执行文件> <隔离 home>}"
# 可选：额外启动参数（例如容器/CI 里需要 --no-sandbox；普通桌面用户不用设）
read -r -a APP_ARGS <<< "${COLLECT_APP_ARGS:-}"
OUT="$(mktemp -d /tmp/issue260-XXXXXX)" || exit 1
echo "OUT=$OUT"
START=$(date +%s%3N)
die() { echo "ERROR: $*" >&2; exit 1; }
command -v gcc >/dev/null 2>&1 || die "需要 gcc（Arch/CachyOS: sudo pacman -S gcc）"
command -v curl >/dev/null 2>&1 || die "需要 curl"
command -v ss >/dev/null 2>&1 || die "需要 ss（iproute2）"

cat > "$OUT/ppoll-hook.c" <<'HOOK_EOF'
// ppoll-hook.c - LD_PRELOAD tracer for dsh-bottom-info-bar issue #260
//
// Logs the first ppoll()/poll()/g_main_context_iteration() calls that happen on
// the MAIN thread of the DSH host child process, together with a native
// backtrace. It works without ptrace, so it can be used in containers that
// forbid gdb/eu-stack attach.
//
// Build:   gcc -shared -fPIC -O2 -o ppoll-hook.so ppoll-hook.c -ldl
// Run:     LD_PRELOAD=/absolute/path/ppoll-hook.so \
//          PPOLL_HOOK_OUT=/tmp/ppoll-hook.log \
//          /opt/dsh-next/dsh-desktop-next
// Read:    /tmp/ppoll-hook.log  (host process only; other Electron helpers ignore it)
//
// The hook only logs when the process command line contains "host.js", and only
// for the main thread, so the Electron browser/renderer processes stay silent.

#define _GNU_SOURCE
#include <dlfcn.h>
#include <execinfo.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#ifndef SYS_gettid
#define SYS_gettid 186
#endif

static int out_fd = -1;
static int enabled = -1;
static int in_hook = 0;
static int logged = 0;
static const int max_logged = 80;

static void init_state(void) {
  if (enabled >= 0) return;
  char buf[8192];
  int fd = open("/proc/self/cmdline", O_RDONLY);
  ssize_t n = fd >= 0 ? read(fd, buf, sizeof(buf) - 1) : -1;
  if (fd >= 0) close(fd);
  if (n > 0) {
    buf[n] = '\0';
    for (ssize_t i = 0; i + 1 < n; i++) if (buf[i] == '\0') buf[i] = ' ';
  } else {
    buf[0] = '\0';
  }
  enabled = strstr(buf, "host.js") != NULL;
  const char *out = getenv("PPOLL_HOOK_OUT");
  if (out == NULL || out[0] == '\0') out = "/tmp/ppoll-hook.log";
  if (enabled) out_fd = open(out, O_WRONLY | O_CREAT | O_APPEND, 0644);
}

static void log_call(const char *name, const char *detail) {
  if (out_fd < 0) return;
  char head[512];
  int len = snprintf(head, sizeof head,
                     "\n[ppoll-hook] %s | %s | tid=%ld\n",
                     name, detail, (long)syscall(SYS_gettid));
  if (len > 0) {
    ssize_t w = write(out_fd, head, (size_t)len);
    (void)w;
  }
  void *frames[32];
  int depth = backtrace(frames, 32);
  backtrace_symbols_fd(frames, depth, out_fd);
}

static void maybe_log(const char *name, const char *detail) {
  if (in_hook) return;
  in_hook = 1;
  init_state();
  if (enabled && (pid_t)syscall(SYS_gettid) == getpid() && logged < max_logged) {
    logged++;
    log_call(name, detail);
  }
  in_hook = 0;
}

typedef int (*ppoll_fn)(struct pollfd *, nfds_t, const struct timespec *, const sigset_t *);
int ppoll(struct pollfd *fds, nfds_t nfds, const struct timespec *timeout, const sigset_t *sigmask) {
  static ppoll_fn real = NULL;
  if (real == NULL) real = (ppoll_fn)dlsym(RTLD_NEXT, "ppoll");
  char detail[96];
  snprintf(detail, sizeof detail, "nfds=%u timeout=%s",
           (unsigned)nfds, timeout == NULL ? "NULL" : "set");
  maybe_log("ppoll", detail);
  return real(fds, nfds, timeout, sigmask);
}

typedef int (*poll_fn)(struct pollfd *, nfds_t, int);
int poll(struct pollfd *fds, nfds_t nfds, int timeout) {
  static poll_fn real = NULL;
  if (real == NULL) real = (poll_fn)dlsym(RTLD_NEXT, "poll");
  char detail[96];
  snprintf(detail, sizeof detail, "nfds=%u timeout=%d", (unsigned)nfds, timeout);
  maybe_log("poll", detail);
  return real(fds, nfds, timeout);
}

typedef int (*gmci_fn)(void *, int);
int g_main_context_iteration(void *context, int may_block) {
  static gmci_fn real = NULL;
  if (real == NULL) real = (gmci_fn)dlsym(RTLD_NEXT, "g_main_context_iteration");
  maybe_log("g_main_context_iteration", may_block ? "blocking" : "nonblocking");
  if (real != NULL) return real(context, may_block);
  return 0;
}

HOOK_EOF

gcc -shared -fPIC -O2 -o "$OUT/ppoll-hook.so" "$OUT/ppoll-hook.c" -ldl || die "hook 编译失败"
echo "hook built"

DSH_DESKTOP_NEXT_HOME="$HOME_DIR" LD_PRELOAD="$OUT/ppoll-hook.so" PPOLL_HOOK_OUT="$OUT/hook.log" \
  "$APP" "${APP_ARGS[@]}" >"$OUT/app.log" 2>&1 &
APP_PID=$!
echo "app pid=$APP_PID"
trap 'kill -TERM "$APP_PID" 2>/dev/null' EXIT

LOG="$HOME_DIR/logs/desktop-next.log"
PORT=""
for _ in $(seq 1 240); do
  PORT=$(grep -aoE 'dsh web: http://127\.0\.0\.1:[0-9]+' "$LOG" 2>/dev/null | tail -1 | grep -oE '[0-9]+$' || true)
  [ -n "$PORT" ] && break
  sleep 0.5
done
if [ -z "$PORT" ]; then
  echo "宿主端口没有出现，可能启动失败；收集 app.log"
  cp "$LOG" "$OUT/desktop-next.log" 2>/dev/null || true
  kill -TERM "$APP_PID" 2>/dev/null
  tar -czf "$OUT/evidence.tar.gz" -C "$OUT" . && echo "DONE: $OUT/evidence.tar.gz"
  exit 0
fi
echo "host port=$PORT"

probe() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 2.5 "http://127.0.0.1:$PORT/" 2>/dev/null || echo "timeout"
}

HOST_PID=""
for t in 8 10 12 14 16 18 20; do
  while [ $(( $(date +%s%3N) - START )) -lt $(( t * 1000 )) ]; do sleep 0.2; done
  code=$(probe)
  echo "probe t=${t}s -> ${code}"
  if [ -z "$HOST_PID" ]; then
    HOST_PID=$(ss -ltnp 2>/dev/null | grep "127.0.0.1:$PORT " | sed -nE 's/.*pid=([0-9]+).*/\\1/p' | head -1)
  fi
done

dump_proc() {
  local pid="$1" dir="$2"
  mkdir -p "$dir"
  cp "/proc/$pid/maps" "$dir/maps.txt" 2>/dev/null || true
  ls -l "/proc/$pid/fd" > "$dir/fds.txt" 2>&1 || true
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -E '^(DISPLAY|WAYLAND_DISPLAY|XDG_SESSION_TYPE|XDG_CURRENT_DESKTOP|DBUS_SESSION_BUS_ADDRESS|AT_SPI_BUS_ADDRESS|GTK|GDK|NO_AT_BRIDGE|SHELL|LANG|LC_)' > "$dir/env.txt" 2>/dev/null || true
  for task in /proc/"$pid"/task/*; do
    local tid; tid=$(basename "$task")
    echo "tid=$tid comm=$(cat "$task/comm" 2>/dev/null) wchan=$(cat "$task/wchan" 2>/dev/null) syscall=$(cat "$task/syscall" 2>/dev/null)" >> "$dir/threads.txt"
  done
  ps -o pid,ppid,args -p "$pid" > "$dir/host.txt" 2>&1 || true
  ps -eo pid,ppid,args --ppid "$pid" > "$dir/children.txt" 2>&1 || true
}

if [ -n "$HOST_PID" ]; then
  echo "host pid=$HOST_PID"
  dump_proc "$HOST_PID" "$OUT/wedged"
fi

cp "$LOG" "$OUT/desktop-next.log" 2>/dev/null || true
kill -TERM "$APP_PID" 2>/dev/null
sleep 3
kill -KILL "$APP_PID" 2>/dev/null
tar -czf "$OUT/evidence.tar.gz" -C "$OUT" .
echo "hook log lines: $(wc -l < "$OUT/hook.log" 2>/dev/null || echo 0)"
echo "DONE: $OUT/evidence.tar.gz"
