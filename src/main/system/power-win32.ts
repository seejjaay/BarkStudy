// The power state, read through koffi: one call, kernel32.GetSystemPowerStatus. It says whether battery saver is on;
// nothing else here touches the system.
import * as koffi from 'koffi';

interface SystemPowerStatus {
  ACLineStatus: number;
  BatteryFlag: number;
  BatteryLifePercent: number;
  /** 1 while battery saver is on. */
  SystemStatusFlag: number;
  BatteryLifeTime: number;
  BatteryFullLifeTime: number;
}

type GetSystemPowerStatus = (out: Partial<SystemPowerStatus>) => boolean;

let bound: GetSystemPowerStatus | null = null;

/** Binds the call on first use, so a missing library or a bad declaration fails inside the read, where it is handled. */
function bind(): GetSystemPowerStatus {
  if (bound) return bound;
  const kernel32 = koffi.load('kernel32.dll');
  // Unnamed, so a second attempt after a failure does not trip over a type already declared.
  const status = koffi.struct({
    ACLineStatus: 'uint8',
    BatteryFlag: 'uint8',
    BatteryLifePercent: 'uint8',
    SystemStatusFlag: 'uint8',
    BatteryLifeTime: 'uint32',
    BatteryFullLifeTime: 'uint32',
  });
  bound = kernel32.func('__stdcall', 'GetSystemPowerStatus', 'bool', [koffi.out(koffi.pointer(status))]) as GetSystemPowerStatus;
  return bound;
}

/** True while Windows battery saver is on. Throws if the library cannot be loaded or the call fails. */
export function readBatterySaver(): boolean {
  const out: Partial<SystemPowerStatus> = {};
  if (!bind()(out)) throw new Error('GetSystemPowerStatus failed');
  return out.SystemStatusFlag === 1;
}
