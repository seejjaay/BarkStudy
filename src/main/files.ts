import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import type { Result } from '../shared/control';
import { MAX_IMPORT_CHARS, type FileAccess } from './controlHandlers';

/** The native open and save dialogs, parented to the control window so they cannot hide behind it. */
export function createFileAccess(parent: () => BrowserWindow | null): FileAccess {
  return {
    async pickImport(): Promise<Result<{ name: string; text: string } | null>> {
      const win = parent();
      const options = {
        title: 'Import cards',
        properties: ['openFile' as const],
        filters: [
          { name: 'Cards (CSV, TSV, text)', extensions: ['csv', 'tsv', 'txt'] },
          { name: 'All files', extensions: ['*'] },
        ],
      };
      const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      const path = chosen.filePaths[0];
      if (chosen.canceled || path === undefined) return { ok: true, value: null };
      try {
        if ((await stat(path)).size > MAX_IMPORT_CHARS * 4) return { ok: false, error: { code: 'file-too-large', message: 'that file is too large to import' } };
        const text = await readFile(path, 'utf8');
        if (text.length > MAX_IMPORT_CHARS) return { ok: false, error: { code: 'file-too-large', message: 'that file is too large to import' } };
        return { ok: true, value: { name: basename(path, extname(path)), text } };
      } catch (e) {
        return { ok: false, error: { code: 'file-unreadable', message: e instanceof Error ? e.message : String(e) } };
      }
    },

    async saveExport(suggestedName, csv) {
      const win = parent();
      const options = { title: 'Export deck', defaultPath: suggestedName, filters: [{ name: 'CSV', extensions: ['csv'] }] };
      const chosen = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (chosen.canceled || !chosen.filePath) return null;
      await writeFile(chosen.filePath, csv, 'utf8');
      return { path: chosen.filePath };
    },
  };
}
