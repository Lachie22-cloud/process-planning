import type { Page, Request, Route } from "@playwright/test";

const SUPABASE_URL = process.env.PW_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_HOSTNAME_PREFIX = new URL(SUPABASE_URL).hostname.split(".")[0];
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers":
    "authorization,apikey,content-type,x-client-info,prefer,accept,accept-profile,content-profile,range",
};

interface TableMap {
  [table: string]: Array<Record<string, unknown>>;
}

function isoNow() {
  return new Date().toISOString();
}

function seededTables(): TableMap {
  const now = isoNow();
  return {
    site_users: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        site_id: "00000000-0000-4000-8000-000000000010",
        external_id: "00000000-0000-4000-8000-000000000999",
        email: "site-admin@example.com",
        display_name: "Smoke Admin",
        role: "site_admin",
        active: true,
        preferences: {},
        created_at: now,
        updated_at: now,
      },
    ],
    sites: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        name: "Rocklea",
        code: "ROCK",
        timezone: "Australia/Brisbane",
        week_end_day: "Friday",
        schedule_horizon: 6,
        config: {},
        active: true,
        created_at: now,
      },
    ],
    resources: [
      {
        id: "00000000-0000-4000-8000-000000000101",
        site_id: "00000000-0000-4000-8000-000000000010",
        resource_code: "MIX-01",
        resource_type: "mixer",
        display_name: "Mixer 1",
        trunk_line: "A",
        group_name: "Group A",
        min_capacity: 500,
        max_capacity: 2000,
        max_batches_per_day: 4,
        chemical_base: null,
        sort_order: 1,
        active: true,
        config: {},
        created_at: now,
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        site_id: "00000000-0000-4000-8000-000000000010",
        resource_code: "MIX-02",
        resource_type: "mixer",
        display_name: "Mixer 2",
        trunk_line: "B",
        group_name: "Group A",
        min_capacity: 500,
        max_capacity: 2000,
        max_batches_per_day: 4,
        chemical_base: null,
        sort_order: 2,
        active: true,
        config: {},
        created_at: now,
      },
    ],
    batches: [],
    bulk_alerts: [],
    notifications: [],
    schedule_rules: [
      {
        id: "00000000-0000-4000-8000-000000000201",
        site_id: "00000000-0000-4000-8000-000000000010",
        name: "Default rule",
        description: "Default schedule rule",
        rule_type: "schedule",
        conditions: {},
        actions: {},
        rule_version: 1,
        schema_id: "schedule.rule.v1",
        enabled: true,
        created_by: "seed",
        created_at: now,
      },
    ],
    substitution_rules: [],
    audit_log: [],
    admin_actions: [],
  };
}

function applyFilter(rows: Array<Record<string, unknown>>, key: string, value: string) {
  if (key === "select" || key === "order" || key === "limit" || key === "offset") {
    return rows;
  }

  if (value.startsWith("eq.")) {
    const expected = decodeURIComponent(value.slice(3));
    return rows.filter((row) => {
      const actual = row[key];
      if (expected === "true" || expected === "false") {
        return Boolean(actual) === (expected === "true");
      }
      return String(actual) === expected;
    });
  }

  if (value.includes("in.(") && value.endsWith(")")) {
    const expected = value
      .slice(value.indexOf("in.(") + 4, -1)
      .split(",")
      .map((v) => decodeURIComponent(v).replace(/^"|"$/g, "").trim());
    return rows.filter((row) => expected.includes(String(row[key])));
  }

  if (value.startsWith("gte.")) {
    const expected = decodeURIComponent(value.slice(4));
    return rows.filter((row) => String(row[key]) >= expected);
  }

  if (value.startsWith("lte.")) {
    const expected = decodeURIComponent(value.slice(4));
    return rows.filter((row) => String(row[key]) <= expected);
  }

  if (value.startsWith("like.")) {
    const expected = decodeURIComponent(value.slice(5)).replace(/%/g, "");
    return rows.filter((row) => String(row[key]).includes(expected));
  }

  return rows;
}

function applyQueryFilters(
  rows: Array<Record<string, unknown>>,
  params: URLSearchParams,
): Array<Record<string, unknown>> {
  let filtered = [...rows];

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    for (const value of values) {
      filtered = applyFilter(filtered, key, value);
    }
  }

  const order = params.get("order");
  if (order) {
    const [column, direction] = order.split(".");
    filtered.sort((a, b) => {
      const left = String(a[column] ?? "");
      const right = String(b[column] ?? "");
      if (left === right) return 0;
      const cmp = left > right ? 1 : -1;
      return direction === "desc" ? -cmp : cmp;
    });
  }

  const limit = params.get("limit");
  if (limit) {
    const parsed = Number(limit);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      filtered = filtered.slice(0, parsed);
    }
  }

  return filtered;
}

function resolveTable(pathname: string) {
  const prefix = "/rest/v1/";
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length).split("/")[0] ?? null;
}

function wantsSingle(request: Request) {
  const accept = request.headers()["accept"] ?? "";
  return accept.includes("application/vnd.pgrst.object+json");
}

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

function upsertTimestamps(row: Record<string, unknown>) {
  const now = isoNow();
  if (!("created_at" in row)) {
    row.created_at = now;
  }
  if ("updated_at" in row || !("updated_at" in row)) {
    row.updated_at = now;
  }
}

function nextId(table: string, rows: Array<Record<string, unknown>>) {
  const suffix = String(rows.length + 1).padStart(12, "0");
  const tableHash = String(table.length).padStart(4, "0");
  return `00000000-0000-4000-8${tableHash}-${suffix}`;
}

function applyMutations(
  tableRows: Array<Record<string, unknown>>,
  method: string,
  payload: unknown,
  params: URLSearchParams,
  table: string,
): Array<Record<string, unknown>> {
  const filtered = applyQueryFilters(tableRows, params);

  if (method === "POST") {
    const rows = Array.isArray(payload) ? payload : [payload];
    const inserted = rows.map((row) => {
      const value = { ...(row as Record<string, unknown>) };
      if (!value.id) {
        value.id = nextId(table, tableRows);
      }
      upsertTimestamps(value);
      tableRows.push(value);
      return value;
    });
    return inserted;
  }

  if (method === "PATCH") {
    const patch = (payload ?? {}) as Record<string, unknown>;
    for (const row of tableRows) {
      if (filtered.includes(row)) {
        Object.assign(row, patch);
        upsertTimestamps(row);
      }
    }
    return filtered;
  }

  if (method === "DELETE") {
    const removedIds = new Set(filtered.map((row) => row.id));
    for (let i = tableRows.length - 1; i >= 0; i -= 1) {
      if (removedIds.has(tableRows[i].id)) {
        tableRows.splice(i, 1);
      }
    }
    return filtered;
  }

  return filtered;
}

export async function installSupabaseMocks(page: Page) {
  const tables = seededTables();
  const session = {
    access_token: "smoke-access-token",
    refresh_token: "smoke-refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: {
      id: "00000000-0000-4000-8000-000000000999",
      aud: "authenticated",
      role: "authenticated",
      email: "site-admin@example.com",
      app_metadata: { provider: "azure" },
      user_metadata: {},
    },
  };

  await page.addInitScript(
    ({ storageKeys, storageValue }) => {
      for (const key of storageKeys) {
        window.localStorage.setItem(key, JSON.stringify(storageValue));
      }
    },
    {
      storageKeys: [
        `sb-${SUPABASE_HOSTNAME_PREFIX}-auth-token`,
        "sb-localhost-auth-token",
        "sb-127-auth-token",
      ],
      storageValue: session,
    },
  );

  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (pathname.endsWith("/auth/v1/user")) {
      return jsonResponse(route, session.user, 200);
    }

    if (pathname.endsWith("/auth/v1/logout")) {
      return jsonResponse(route, {}, 200);
    }

    return jsonResponse(route, {}, 200);
  });

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const table = resolveTable(url.pathname);
    if (!table || !tables[table]) {
      return jsonResponse(route, [], 200);
    }

    const tableRows = tables[table];
    const method = request.method();

    if (method === "GET") {
      const rows =
        table === "site_users"
          ? tableRows.filter((row) => row.active !== false)
          : table === "sites"
            ? tableRows.filter((row) => row.active !== false)
            : applyQueryFilters(tableRows, url.searchParams);
      if (wantsSingle(request)) {
        return jsonResponse(route, rows[0] ?? null, rows.length > 0 ? 200 : 404);
      }
      return jsonResponse(route, rows, 200);
    }

    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      const bodyText = request.postData() ?? "null";
      const payload = JSON.parse(bodyText);
      const rows = applyMutations(tableRows, method, payload, url.searchParams, table);

      if (url.searchParams.has("select") || wantsSingle(request)) {
        if (wantsSingle(request)) {
          return jsonResponse(route, rows[0] ?? null, rows.length > 0 ? 200 : 404);
        }
        return jsonResponse(route, rows, 200);
      }

      return jsonResponse(route, [], 201);
    }

    return jsonResponse(route, [], 200);
  });

  await page.route("**/realtime/v1/**", async (route) => {
    await route.fulfill({ status: 200, body: "" });
  });
}
