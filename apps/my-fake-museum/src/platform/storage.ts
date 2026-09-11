/**
 * Save storage.
 *
 * One interface, three backends: Electron (file system via preload bridge),
 * Capacitor (native Preferences) and the browser (localStorage). The web path
 * is also the fallback when a native bridge is missing, so a broken bridge
 * degrades to "saves work but only on this device" rather than "saves are gone".
 *
 * Two slots are always written: `main` and `backup`. Loading prefers `main`
 * and falls back to `backup`, which is what turns a mid-write crash from lost
 * progress into one lost day.
 */

const MAIN_KEY = 'mfm.save.v1';
const BACKUP_KEY = 'mfm.save.v1.backup';

export interface StorageBackend {
  readonly name: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface ElectronBridge {
  readSave(key: string): Promise<string | null>;
  writeSave(key: string, value: string): Promise<void>;
  removeSave(key: string): Promise<void>;
}

interface CapacitorPreferences {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

declare global {
  interface Window {
    mfmBridge?: ElectronBridge;
    Capacitor?: { Plugins?: { Preferences?: CapacitorPreferences } };
  }
}

const memoryBackend = (): StorageBackend => {
  const map = new Map<string, string>();
  return {
    name: 'memory',
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
  };
};

function webBackend(): StorageBackend {
  return {
    name: 'localStorage',
    async get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Private mode / disabled storage: behave as "no save", never throw.
        return null;
      }
    },
    async set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        // QuotaExceededError is the realistic case here; surface it to the
        // caller so the UI can tell the player their save did not stick.
        throw new Error(`保存に失敗しました: ${(error as Error).message}`);
      }
    },
    async remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export function detectBackend(): StorageBackend {
  if (typeof window === 'undefined') return memoryBackend();

  const bridge = window.mfmBridge;
  if (bridge && typeof bridge.readSave === 'function') {
    return {
      name: 'electron',
      get: (key) => bridge.readSave(key),
      set: (key, value) => bridge.writeSave(key, value),
      remove: (key) => bridge.removeSave(key),
    };
  }

  const prefs = window.Capacitor?.Plugins?.Preferences;
  if (prefs && typeof prefs.get === 'function') {
    return {
      name: 'capacitor',
      async get(key) {
        const { value } = await prefs.get({ key });
        return value ?? null;
      },
      set: (key, value) => prefs.set({ key, value }),
      remove: (key) => prefs.remove({ key }),
    };
  }

  if (typeof window.localStorage !== 'undefined') return webBackend();
  return memoryBackend();
}

export class SaveStore {
  constructor(private readonly backend: StorageBackend = detectBackend()) {}

  get backendName(): string {
    return this.backend.name;
  }

  /**
   * Write main, then backup. Order matters: if the process dies between the
   * two, `main` is the newer complete write and `backup` is the previous day.
   * Either way one of them parses.
   */
  async save(json: string): Promise<void> {
    const previous = await this.backend.get(MAIN_KEY);
    await this.backend.set(MAIN_KEY, json);
    if (previous !== null) await this.backend.set(BACKUP_KEY, previous);
  }

  async loadRaw(): Promise<{ json: string; slot: 'main' | 'backup' } | null> {
    const main = await this.backend.get(MAIN_KEY);
    if (main !== null && main !== '') return { json: main, slot: 'main' };
    const backup = await this.backend.get(BACKUP_KEY);
    if (backup !== null && backup !== '') return { json: backup, slot: 'backup' };
    return null;
  }

  async clear(): Promise<void> {
    await this.backend.remove(MAIN_KEY);
    await this.backend.remove(BACKUP_KEY);
  }
}
