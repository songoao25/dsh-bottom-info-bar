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
