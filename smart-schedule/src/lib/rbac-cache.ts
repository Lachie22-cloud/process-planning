export type RbacCacheEntry = {
  userId: string;
  siteId: string;
  permissions: string[];
  roleCodes: string[];
  guardrails: Array<{
    id: string;
    permissionCode: string;
    effect: "allow" | "deny";
    priority: number;
    conditions: Record<string, unknown>;
  }>;
  fetchedAt: string;
};

export type RbacCache = {
  get(userId: string, siteId: string): Promise<RbacCacheEntry | null>;
  set(entry: RbacCacheEntry): Promise<void>;
  invalidateUserSite(userId: string, siteId: string): Promise<void>;
  invalidateSite(siteId: string): Promise<void>;
  clear(): Promise<void>;
};

type InMemoryRecord = {
  entry: RbacCacheEntry;
  expiresAt: number;
};

export class InMemoryRbacCache implements RbacCache {
  private readonly ttlMs: number;
  private readonly store = new Map<string, InMemoryRecord>();
  private readonly siteIndex = new Map<string, Set<string>>();

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  async get(userId: string, siteId: string): Promise<RbacCacheEntry | null> {
    const key = this.key(userId, siteId);
    const record = this.store.get(key);
    if (!record) {
      return null;
    }

    if (Date.now() >= record.expiresAt) {
      this.removeByKey(key, siteId);
      return null;
    }

    return record.entry;
  }

  async set(entry: RbacCacheEntry): Promise<void> {
    const key = this.key(entry.userId, entry.siteId);
    this.store.set(key, {
      entry,
      expiresAt: Date.now() + this.ttlMs,
    });

    const existingKeys = this.siteIndex.get(entry.siteId) ?? new Set<string>();
    existingKeys.add(key);
    this.siteIndex.set(entry.siteId, existingKeys);
  }

  async invalidateUserSite(userId: string, siteId: string): Promise<void> {
    const key = this.key(userId, siteId);
    this.removeByKey(key, siteId);
  }

  async invalidateSite(siteId: string): Promise<void> {
    const keys = this.siteIndex.get(siteId);
    if (!keys) {
      return;
    }

    for (const key of keys) {
      this.store.delete(key);
    }
    this.siteIndex.delete(siteId);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.siteIndex.clear();
  }

  private key(userId: string, siteId: string): string {
    return `${siteId}:${userId}`;
  }

  private removeByKey(key: string, siteId: string): void {
    this.store.delete(key);
    const keys = this.siteIndex.get(siteId);
    if (!keys) {
      return;
    }

    keys.delete(key);
    if (keys.size === 0) {
      this.siteIndex.delete(siteId);
    }
  }
}

const defaultCache = new InMemoryRbacCache();

export function getDefaultRbacCache(): RbacCache {
  return defaultCache;
}
