// Read-only Win32 access through koffi: window bounds, z-order, foreground window, minimized and cloaked
// flags, and process image names. Nothing here reads titles or contents, and nothing acts on another window.
import * as koffi from 'koffi';
import type { Win32Api, Win32Window } from './tracker';

type Hwnd = number;

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr hwnd, intptr lParam)');
const WinEventProc = koffi.proto(
  'void __stdcall WinEventProc(intptr hHook, uint32 event, intptr hwnd, int32 idObject, int32 idChild, uint32 thread, uint32 time)',
);
koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });

interface Rect32 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const DWMWA_CLOAKED = 14;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// Event ranges: foreground, move/size start+end, minimize start+end, destroy/show/hide, location change.
const EVENT_RANGES: readonly (readonly [number, number])[] = [
  [0x0003, 0x0003],
  [0x000a, 0x000b],
  [0x0016, 0x0017],
  [0x8001, 0x8003],
  [0x800b, 0x800b],
];

export function realWin32(): Win32Api {
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr lParam)') as (cb: unknown, lParam: number) => boolean;
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr hwnd)') as (h: Hwnd) => boolean;
  const IsIconic = user32.func('bool __stdcall IsIconic(intptr hwnd)') as (h: Hwnd) => boolean;
  const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)') as (h: Hwnd, i: number) => number | bigint;
  const GetForegroundWindow = user32.func('intptr __stdcall GetForegroundWindow()') as () => number | bigint;
  const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)') as (h: Hwnd, pid: number[]) => number;
  const SetWinEventHook = user32.func(
    'intptr __stdcall SetWinEventHook(uint32 eventMin, uint32 eventMax, intptr hmod, WinEventProc *cb, uint32 pid, uint32 tid, uint32 flags)',
  ) as (min: number, max: number, hmod: number, cb: unknown, pid: number, tid: number, flags: number) => number | bigint;
  const UnhookWinEvent = user32.func('bool __stdcall UnhookWinEvent(intptr hook)') as (h: number | bigint) => boolean;
  const DwmGetCloaked = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ int *out, uint32 size)') as (
    h: Hwnd,
    attr: number,
    out: number[],
    size: number,
  ) => number;
  const DwmGetRect = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ RECT *out, uint32 size)') as (
    h: Hwnd,
    attr: number,
    out: Partial<Rect32>,
    size: number,
  ) => number;
  const OpenProcess = kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)') as (a: number, i: boolean, pid: number) => number | bigint;
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr h)') as (h: number | bigint) => boolean;
  const QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(intptr proc, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)',
  ) as (proc: number | bigint, flags: number, buf: Buffer, size: number[]) => boolean;

  // One enumeration callback for the life of the binding: registering per call leaks and is slow.
  let collect: Hwnd[] | null = null;
  const enumCallback = koffi.register((hwnd: number | bigint) => {
    collect?.push(Number(hwnd));
    return true;
  }, koffi.pointer(EnumWindowsProc));

  const names = new Map<number, string>();
  function processName(pid: number): string {
    const cached = names.get(pid);
    if (cached !== undefined) return cached;
    let name = '';
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (handle) {
      const buf = Buffer.alloc(1040);
      const size = [520];
      if (QueryFullProcessImageNameW(handle, 0, buf, size)) {
        const full = buf.toString('utf16le', 0, (size[0] ?? 0) * 2);
        name = full.slice(full.lastIndexOf('\\') + 1).toLowerCase();
      }
      CloseHandle(handle);
    }
    names.set(pid, name);
    return name;
  }

  function frameBounds(hwnd: Hwnd) {
    const r: Partial<Rect32> = {};
    if (DwmGetRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0) return null;
    const { left = 0, top = 0, right = 0, bottom = 0 } = r;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  return {
    listWindows(): Win32Window[] {
      const all: Hwnd[] = [];
      collect = all;
      try {
        EnumWindows(enumCallback, 0);
      } finally {
        collect = null;
      }
      const out: Win32Window[] = [];
      for (const id of all) {
        if (!IsWindowVisible(id) || IsIconic(id)) continue;
        if (Number(GetWindowLongPtrW(id, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) continue;
        const cloaked = [0];
        if (DwmGetCloaked(id, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) continue;
        const bounds = frameBounds(id);
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
        const pidOut = [0];
        GetWindowThreadProcessId(id, pidOut);
        const pid = pidOut[0] ?? 0;
        out.push({ id, pid, bounds, processName: processName(pid) });
      }
      return out;
    },

    foreground: () => Number(GetForegroundWindow()),

    hook(onEvent) {
      // Only whole-window events (OBJID_WINDOW, no child) matter; caret and cursor events are noise.
      const callback = koffi.register(
        (_hook: number | bigint, _event: number, _hwnd: number | bigint, idObject: number, idChild: number) => {
          if (idObject === 0 && idChild === 0) onEvent();
        },
        koffi.pointer(WinEventProc),
      );
      const hooks = EVENT_RANGES.map(([lo, hi]) => SetWinEventHook(lo, hi, 0, callback, 0, 0, 0 /* WINEVENT_OUTOFCONTEXT */));
      if (hooks.some((h) => Number(h) === 0)) {
        hooks.forEach((h) => Number(h) !== 0 && UnhookWinEvent(h));
        koffi.unregister(callback);
        throw new Error('SetWinEventHook failed');
      }
      return () => {
        hooks.forEach((h) => UnhookWinEvent(h));
        koffi.unregister(callback);
      };
    },
  };
}
