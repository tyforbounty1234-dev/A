import type { KeyValueStorage } from '@/lexicore/data/storage';

/**
 * localStorage-backed storage for the offline-first learning store. Falls back
 * to memory when storage is unavailable (private mode, blocked site data).
 */
export class BrowserStorage implements KeyValueStorage {
  private memory = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return this.memory.get(key) ?? null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      this.memory.set(key, value);
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      window.localStorage.removeItem(key);
    } catch {
      this.memory.delete(key);
    }
  }
}
