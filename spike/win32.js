// Throwaway M0 spike. Win32 bindings through koffi. Read-only on other windows: bounds, z-order,
// foreground, minimized/cloaked flags and process image name. Never titles, contents or input to others.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const kernel32 = koffi.load('kernel32.dll');

const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr hwnd, intptr lParam)');
const WinEventProc = koffi.proto(
  'void __stdcall WinEventProc(intptr hHook, uint32 event, intptr hwnd, int32 idObject, int32 idChild, uint32 thread, uint32 time)',
);

const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr hwnd)');
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)');
const GetAncestor = user32.func('intptr __stdcall GetAncestor(intptr hwnd, uint32 flags)');
const WindowFromPoint = user32.func('intptr __stdcall WindowFromPoint(POINT pt)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ RECT *rect)');
const mouse_event = user32.func('void __stdcall mouse_event(uint32 flags, int32 dx, int32 dy, uint32 data, uintptr extra)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
const SetWinEventHook = user32.func(
  'intptr __stdcall SetWinEventHook(uint32 eventMin, uint32 eventMax, intptr hmod, WinEventProc *cb, uint32 pid, uint32 tid, uint32 flags)',
);
const UnhookWinEvent = user32.func('bool __stdcall UnhookWinEvent(intptr hook)');

const DwmGetCloaked = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ int *out, uint32 size)');
const DwmGetRect = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ RECT *out, uint32 size)');

const OpenProcess = kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr h)');
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(intptr proc, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)',
);

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_CLOAKED = 14;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

const processNameCache = new Map();

function pidOf(hwnd) {
  const out = [0];
  GetWindowThreadProcessId(hwnd, out);
  return out[0];
}

function processName(pid) {
  if (processNameCache.has(pid)) return processNameCache.get(pid);
  let name = '';
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (h) {
    const buf = Buffer.alloc(1040);
    const size = [520];
    if (QueryFullProcessImageNameW(h, 0, buf, size)) {
      const full = buf.toString('utf16le', 0, size[0] * 2);
      name = full.slice(full.lastIndexOf('\\') + 1).toLowerCase();
    }
    CloseHandle(h);
  }
  processNameCache.set(pid, name);
  return name;
}

/** Physical-pixel frame bounds as DWM draws them (excludes the invisible resize border). */
function frameBounds(hwnd) {
  const r = {};
  if (DwmGetRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

function rawWindowRect(hwnd) {
  const r = {};
  if (!GetWindowRect(hwnd, r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

function isCloaked(hwnd) {
  const out = [0];
  return DwmGetCloaked(hwnd, DWMWA_CLOAKED, out, 4) === 0 && out[0] !== 0;
}

// koffi callbacks are registered once and reused: registering per call leaks and is slow.
let collect = null;
const enumCb = koffi.register((hwnd) => {
  if (collect) collect.push(hwnd);
  return true;
}, koffi.pointer(EnumWindowsProc));

/**
 * Visible top-level windows in z-order (top first). Skips tool windows, cloaked and minimized windows,
 * zero-size windows, and any window owned by `ownPid`.
 */
function listWindows(ownPid) {
  const all = [];
  collect = all;
  EnumWindows(enumCb, 0);
  collect = null;
  const out = [];
  for (const hwnd of all) {
    if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) continue;
    if (Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) continue;
    if (isCloaked(hwnd)) continue;
    const pid = pidOf(hwnd);
    if (ownPid && pid === ownPid) continue;
    const bounds = frameBounds(hwnd);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
    out.push({ hwnd, pid, process: processName(pid), bounds });
  }
  return out;
}

/** Normalised absolute mouse move (primary screen, physical pixels). */
function moveMouse(px, py) {
  const w = GetSystemMetrics(0);
  const h = GetSystemMetrics(1);
  mouse_event(0x8001 /* MOVE | ABSOLUTE */, Math.round((px * 65535) / (w - 1)), Math.round((py * 65535) / (h - 1)), 0, 0);
}
const mouseDown = () => mouse_event(0x0002, 0, 0, 0, 0);
const mouseUp = () => mouse_event(0x0004, 0, 0, 0, 0);
const keyDown = (vk) => keybd_event(vk, 0, 0, 0);
const keyUp = (vk) => keybd_event(vk, 0, 2, 0);
const tapKey = (vk) => (keyDown(vk), keyUp(vk));

const rootOf = (hwnd) => Number(GetAncestor(hwnd, 2 /* GA_ROOT */));
const windowAt = (x, y) => Number(WindowFromPoint({ x, y }));

module.exports = {
  koffi,
  WinEventProc,
  SetWinEventHook,
  UnhookWinEvent,
  GetForegroundWindow: () => Number(GetForegroundWindow()),
  listWindows,
  frameBounds,
  rawWindowRect,
  pidOf,
  processName,
  rootOf,
  windowAt,
  moveMouse,
  mouseDown,
  mouseUp,
  tapKey,
  GetSystemMetrics,
};
