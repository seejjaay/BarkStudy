import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { makeTrayBitmap } from './trayIcon';
import { buildTrayMenu, parseTrayAction, trayTooltip, type MenuItemSpec, type TrayAction, type TrayInputs } from './trayModel';

export interface AppTray {
  /** Rebuilds the tooltip, and the menu if what it says has changed. Cheap to call often. */
  refresh: () => void;
  /** The menu as last built, for tests. */
  menuSpec: () => MenuItemSpec[];
  /** Runs a menu item as if it had been clicked. Unknown ids are ignored. */
  run: (id: string) => void;
  dispose: () => void;
}

function toTemplate(items: MenuItemSpec[], click: (id: string) => void): MenuItemConstructorOptions[] {
  return items.map((i): MenuItemConstructorOptions => {
    if (i.separator) return { type: 'separator' };
    const out: MenuItemConstructorOptions = { label: i.label, enabled: i.enabled !== false };
    if (i.hint) {
      out.accelerator = i.hint;
      out.registerAccelerator = false; // shown beside the label only; the real shortcut is registered globally elsewhere
    }
    if (i.submenu) out.submenu = toTemplate(i.submenu, click);
    else if (i.id) {
      const id = i.id;
      out.click = () => click(id);
    }
    return out;
  });
}

function trayImage() {
  const image = nativeImage.createEmpty();
  for (const [size, scaleFactor] of [[16, 1], [24, 1.5], [32, 2], [48, 3]] as const) {
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: makeTrayBitmap(size) });
  }
  return image;
}

export function createTray(opts: { inputs: () => TrayInputs; onAction: (action: TrayAction) => void; onOpen: () => void }): AppTray {
  const tray = new Tray(trayImage());
  let lastKey = '';
  let spec: MenuItemSpec[] = [];

  function run(id: string): void {
    const action = parseTrayAction(id);
    if (action) opts.onAction(action);
  }

  function refresh(): void {
    const inputs = opts.inputs();
    tray.setToolTip(trayTooltip(inputs.view));
    spec = buildTrayMenu(inputs);
    const key = JSON.stringify(spec);
    if (key === lastKey) return; // replacing the menu while it is open would close it under the user's pointer
    lastKey = key;
    tray.setContextMenu(Menu.buildFromTemplate(toTemplate(spec, run)));
  }

  // A plain click opens the window; the menu is on the right-click.
  tray.on('click', opts.onOpen);
  refresh();

  return {
    refresh,
    menuSpec: () => spec,
    run,
    dispose: () => tray.destroy(),
  };
}
