import { nativeImage, type NativeImage } from 'electron';
import { makeIcon } from './icon';

let image: NativeImage | undefined;

/** The icon for the control window and the overlays, made once. */
export function windowIcon(): NativeImage {
  image ??= nativeImage.createFromBitmap(makeIcon(256), { width: 256, height: 256 });
  return image;
}
