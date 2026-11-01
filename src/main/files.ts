import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import type { Result } from '../shared/control';
import { MAX_BACKUP_CHARS, MAX_IMPORT_CHARS, type FileAccess } from './controlHandlers';

/**
 * The native open and save dialogs, parented to the control window so they cannot hide behind it.
 * `overridePath` is for the e2e tests only: it hands back (and clears) a path to use for a backup, a deck import or a deck export instead of showing a dialog.
 */
export function createFileAccess(parent: () => BrowserWindow | null, overridePath?: () => string | null): FileAccess {
  return {
    async pickImport(): Promise<Result<{ name: string; text: string } | null>> {
      let path = overridePath?.() ?? undefined;
      if (path === undefined) {
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
        path = chosen.filePaths[0];
        if (chosen.canceled || path === undefined) return { ok: true, value: null };
      }
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
      let path = overridePath?.() ?? undefined;
      if (path === undefined) {
        const win = parent();
        const options = { title: 'Export deck', defaultPath: suggestedName, filters: [{ name: 'CSV', extensions: ['csv'] }] };
        const chosen = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (chosen.canceled || !chosen.filePath) return null;
        path = chosen.filePath;
      }
      await writeFile(path, csv, 'utf8');
      return { path };
    },

    async pickBackup(): Promise<Result<{ path: string; text: string } | null>> {
      let path = overridePath?.() ?? undefined;
      if (path === undefined) {
        const win = parent();
        const options = { title: 'Restore from backup', properties: ['openFile' as const], filters: [{ name: 'BarkStudy backup', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }] };
        const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
        path = chosen.filePaths[0];
        if (chosen.canceled || path === undefined) return { ok: true, value: null };
      }
      try {
        if ((await stat(path)).size > MAX_BACKUP_CHARS * 4) return { ok: false, error: { code: 'file-too-large', message: 'that file is too large to be a backup' } };
        return { ok: true, value: { path, text: await readFile(path, 'utf8') } };
      } catch (e) {
        return { ok: false, error: { code: 'file-unreadable', message: e instanceof Error ? e.message : String(e) } };
      }
    },

    async saveBackup(suggestedName, json) {
      let path = overridePath?.() ?? undefined;
      if (path === undefined) {
        const win = parent();
        const options = { title: 'Export all data', defaultPath: suggestedName, filters: [{ name: 'BarkStudy backup', extensions: ['json'] }] };
        const chosen = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (chosen.canceled || !chosen.filePath) return null;
        path = chosen.filePath;
      }
      await writeFile(path, json, 'utf8');
      return { path };
    },
  };
}
