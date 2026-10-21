import {
  Timestamp,
  addDoc, collection, deleteDoc, doc, getDocs,
  onSnapshot, updateDoc,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import {
  dedupeEventRows,
  normalizeEventDoc,
  normalizeLegacyEvento,
  sortEventsNewestFirst,
} from '@/lib/eventUtils';

// A logica pura da fonte unificada de eventos vive em `@/lib/eventUtils`
// (sem dependencias do Firebase), para ser testavel fora do app.
// Reexportada aqui porque `db.ts` e o ponto de entrada historico do front.
export {
  EVENT_DEDUPE_WINDOW_MS,
  dedupeEventRows,
  eventDedupeKey,
  eventTimestampMs,
  isSameEventOccurrence,
  linkEventToPanel,
  mapLegacyEvent,
  normalizeEventDoc,
  normalizeLegacyEvento,
  sortEventsNewestFirst,
} from '@/lib/eventUtils';
export type { EventRowLike, PanelLink } from '@/lib/eventUtils';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Domain types (kept from the previous data layer)
// ---------------------------------------------------------------------------

export type UserRole = 'platform_admin' | 'tenant_admin' | 'operator' | 'viewer';

export interface Profile {
  id: string;
  tenant_id: string | null;
  full_name: string;
  email: string;
  role: UserRole;
  phone: string | null;
  status: string;
  last_login_at: string | null;
  created_at: string;
}

// Account created for public demonstrations. While signed in with it, the
// monitoring panel and building map render simulated data locally instead of
// querying Firestore (the account itself has no tenant/panels).
export const DEMO_ACCOUNT_EMAIL = 'demo@fireguard.com';

export function isDemoAccount(email: string | null | undefined): boolean {
  return (email ?? '').toLowerCase() === DEMO_ACCOUNT_EMAIL;
}

export interface Tenant {
  id: string;
  name: string;
  legal_name: string | null;
  document: string | null;
  plan: string;
  status: string;
  contact_email: string | null;
  contact_phone: string | null;
  max_buildings: number;
  created_at: string;
}

export interface Building {
  id: string;
  tenant_id: string;
  name: string;
  internal_code: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  technical_contact: string | null;
  operational_contact: string | null;
  panel_count: number;
  notes: string | null;
  avatar_url?: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export interface Panel {
  id: string;
  tenant_id: string;
  building_id: string;
  manufacturer: string;
  model: string;
  asset_code: string | null;
  install_location: string | null;
  zone_count: number;
  has_api: boolean;
  has_ethernet: boolean;
  has_ip: boolean;
  ip_data: string | null;
  /** IP/porta do receptor FireGuard a cadastrar no sensor/gateway (destino dos dados). */
  sensor_ip?: string | null;
  has_relay_output: boolean;
  interface_type: string | null;
  auxiliary_output_type: string | null;
  installed_at: string | null;
  installer: string | null;
  notes: string | null;
  status: string;
}

export interface Gateway {
  id: string;
  tenant_id: string;
  building_id: string;
  panel_id: string | null;
  name: string;
  device_code: string;
  manufacturer: string | null;
  model: string | null;
  unique_identifier: string | null;
  connectivity_type: string;
  firmware_version: string | null;
  config_version: string | null;
  input_count: number;
  status: string;
  last_heartbeat_at: string | null;
  last_event_at: string | null;
  heartbeat_interval_sec: number;
  offline_threshold_sec: number;
  downtime_started_at: string | null;
  provisioned: boolean;
}

export interface GatewayInput {
  id: string;
  tenant_id: string;
  gateway_id: string;
  panel_id: string | null;
  input_number: number;
  name: string;
  event_type: string;
  current_state: string;
  last_change_at: string | null;
  last_comm_at: string | null;
}

export interface EventRow {
  id: string;
  tenant_id: string | null;
  gateway_id: string | null;
  building_id: string | null;
  panel_id: string | null;
  input_id: string | null;
  external_event_id: string | null;
  sequence: number | null;
  event_type: string;
  state: string;
  input_ref: string | null;
  occurred_at: string;
  received_at: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  severity: string;
  origem_ip?: string | null;
  conta?: string | null;
  codigo_contato?: string | null;
  qualificador?: string | null;
  particao?: string | null;
  zona?: string | null;
  descricao?: string | null;
  bruto?: string | null;
  input_number?: number | null;
}

export interface Incident {
  id: string;
  tenant_id: string;
  building_id: string | null;
  panel_id: string | null;
  gateway_id: string | null;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  opened_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  response_time_sec: number | null;
}

export interface AuditLog {
  id: string;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationSubscription {
  id: string;
  tenant_id: string;
  user_id: string;
  building_id: string | null;
  event_types: string[];
  channels: string[];
  escalation_minutes: number;
  active: boolean;
  fcm_token: string | null;
}

// ---------------------------------------------------------------------------
// Eventos: unifica `events` (nova) + `eventos` (legada do receptor antigo).
//
// A logica pura (decodificacao do Contact ID, normalizacao, deduplicacao e
// ordenacao) vive em `@/lib/eventUtils`, sem dependencia do Firebase, para
// poder ser testada isoladamente. Aqui fica apenas a camada Firestore.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

/**
 * ---------------------------------------------------------------------------
 * Carregador unificado de eventos (`events` + `eventos` legado)
 * ---------------------------------------------------------------------------
 *
 * Regras:
 *   - Le as DUAS colecoes (`events` e `eventos`) e normaliza cada documento
 *     para o mesmo formato EventRow.
 *   - Deduplica pelo `external_event_id` (Contact ID). Em caso de conflito
 *     entre as colecoes, o documento de `events` tem precedencia (schema mais
 *     completo); o legado preenche apenas o que faltar.
 *   - Ordena do mais recente para o mais antigo (received_at desc).
 *   - Filtro de tenant: mantem eventos do tenant e eventos sem tenant
 *     vinculado (centrais sem empresa cadastrada).
 */
export async function fetchUnifiedEvents(
  limitN = 500,
  options: { tenantId?: string | null } = {},
): Promise<EventRow[]> {
  const { getDocs: gds, collection: col } = await import('firebase/firestore');
  const { firestore: fs } = await import('@/lib/firebase');

  const readCollection = async (name: string): Promise<{ id: string; data: Row }[]> => {
    try {
      const snap = await gds(col(fs, name));
      return snap.docs.map((d) => ({ id: d.id, data: (toPlain(d.data()) as Row) ?? {} }));
    } catch {
      return [];
    }
  };

  const [modernDocs, legacyDocs, panelDocs, gatewayDocs] = await Promise.all([
    readCollection('events'),
    readCollection('eventos'),
    readCollection('panels'),
    readCollection('gateways'),
  ]);

  // Tenant/building herdados do painel (eventos legados podem nao ter o vinculo).
  const panelInfo = new Map<string, { tenant_id: string | null; building_id: string | null }>();
  // Mapeia asset_code do painel -> { tenant_id, building_id } para eventos legados que so trazem `conta`.
  const panelByAssetCode = new Map<string, { tenant_id: string | null; building_id: string | null }>();
  for (const p of panelDocs) {
    const info = {
      tenant_id: (p.data.tenant_id as string | null) ?? null,
      building_id: (p.data.building_id as string | null) ?? null,
    };
    panelInfo.set(p.id, info);
    const asset = p.data.asset_code;
    if (asset != null && asset !== '') {
      panelByAssetCode.set(String(asset), info);
    }
  }

  // Tenant/building herdados do gateway (eventos podem vincular via gateway_id).
  const gatewayInfo = new Map<string, { tenant_id: string | null; building_id: string | null }>();
  for (const g of gatewayDocs) {
    gatewayInfo.set(g.id, {
      tenant_id: (g.data.tenant_id as string | null) ?? null,
      building_id: (g.data.building_id as string | null) ?? null,
    });
  }

  /** Tenta preencher tenant_id e building_id do evento via panel, gateway ou conta (asset_code). */
  const inheritLinks = (row: Row) => {
    if (row.panel_id) {
      const info = panelInfo.get(String(row.panel_id));
      if (info) {
        if (!row.tenant_id) row.tenant_id = info.tenant_id;
        if (!row.building_id) row.building_id = info.building_id;
      }
    }
    if ((!row.tenant_id || !row.building_id) && row.gateway_id) {
      const info = gatewayInfo.get(String(row.gateway_id));
      if (info) {
        if (!row.tenant_id) row.tenant_id = info.tenant_id;
        if (!row.building_id) row.building_id = info.building_id;
      }
    }
    // Fallback: eventos legados so trazem `conta` (asset_code do painel).
    if ((!row.tenant_id || !row.building_id) && row.conta) {
      const info = panelByAssetCode.get(String(row.conta));
      if (info) {
        if (!row.tenant_id) row.tenant_id = info.tenant_id;
        if (!row.building_id) row.building_id = info.building_id;
      }
    }
  };

  const rows: Row[] = [];

  // 1) Colecao nova (`events`) — fonte primaria.
  for (const d of modernDocs) {
    try {
      const row = normalizeEventDoc(d.id, d.data);
      inheritLinks(row);
      row.__source = 'events';
      rows.push(row);
    } catch { /* ignora documento invalido */ }
  }

  // 2) Colecao legada (`eventos`) — normalizada e com vinculo herdado do painel.
  for (const d of legacyDocs) {
    try {
      const leg = normalizeLegacyEvento(d.id, d.data);
      inheritLinks(leg);
      leg.__source = 'eventos';
      rows.push(leg);
    } catch { /* ignora documento invalido */ }
  }

  const deduped = dedupeEventRows(rows);

  // 4) Mais recentes primeiro (empate resolvido pelo id, para ser deterministico).
  sortEventsNewestFirst(deduped);

  // 5) Filtro de tenant (eventos sem tenant vinculado continuam visiveis).
  const tenantId = options.tenantId ?? null;
  const scoped = tenantId
    ? deduped.filter((e) => e.tenant_id == null || e.tenant_id === '' || e.tenant_id === tenantId)
    : deduped;

  return scoped.slice(0, limitN) as EventRow[];
}

/**
 * Busca a colecao de eventos unificada (`events` + `eventos` legado).
 */
export async function fetchAllEvents(limitN = 500): Promise<Row[]> {
  return fetchUnifiedEvents(limitN);
}

/** Firestore Timestamps (and nested objects/arrays) → ISO strings. */
function toPlain(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') {
    const out: Row = {};
    for (const [k, v] of Object.entries(value as Row)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

/** Firestore rejects `undefined` values — strip them from write payloads. */
function cleanPayload(payload: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Null-safe comparison used for `gte` filters and client-side ordering. */
function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/** Project `select('id, name')` column lists. */
function pick(row: Row, columns: string): Row {
  const out: Row = {};
  for (const col of columns.split(',').map((c) => c.trim()).filter(Boolean)) {
    out[col] = row[col];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Query builder (subset of the previous data-client API backed by Firestore)
// ---------------------------------------------------------------------------

interface Filter {
  field: string;
  op: '==' | '>=';
  value: unknown;
}

function makeSelectBuilder(collectionName: string, columns = '*', options: { count?: string; head?: boolean } = {}) {
  const filters: Filter[] = [];
  let orderField: string | null = null;
  let orderAsc = true;
  let limitN: number | null = null;
  let cols = columns;
  let opts = options;

  async function execSelect(): Promise<{ data: Row[]; count?: number; error: null }> {
    const snap = await getDocs(collection(firestore, collectionName));
    let rows: Row[] = snap.docs.map((d) => ({ id: d.id, ...(toPlain(d.data()) as Row) }));
    for (const f of filters) {
      if (f.value === undefined) continue;
      if (f.op === '==') rows = rows.filter((r) => r[f.field] === f.value);
      else rows = rows.filter((r) => compare(r[f.field], f.value) >= 0);
    }
    const total = rows.length;
    if (orderField) rows = [...rows].sort((a, b) => (orderAsc ? compare(a[orderField as string], b[orderField as string]) : compare(b[orderField as string], a[orderField as string])));
    if (limitN !== null) rows = rows.slice(0, limitN);
    let data: Row[] = rows;
    if (opts.head) data = [];
    else if (cols !== '*') data = rows.map((r) => ({ id: r.id, ...pick(r, cols) }));
    const out: { data: Row[]; count?: number; error: null } = { data, error: null };
    if (opts.count === 'exact') out.count = total;
    return out;
  }

  function select(c = '*', o: { count?: string; head?: boolean } = {}) {
    cols = c;
    opts = o;
    return builder;
  }
  function eq(field: string, value: unknown) {
    filters.push({ field, op: '==', value });
    return builder;
  }
  function match(obj: Record<string, unknown>) {
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (v !== undefined && v !== null) filters.push({ field: k, op: '==', value: v });
    }
    return builder;
  }
  function gte(field: string, value: unknown) {
    filters.push({ field, op: '>=', value });
    return builder;
  }
  function order(field: string, o: { ascending?: boolean } = {}) {
    orderField = field;
    orderAsc = o.ascending ?? true;
    return builder;
  }
  function limit(n: number) {
    limitN = n;
    return builder;
  }
  async function maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const res = await execSelect();
    return { data: (res.data[0] as Row | undefined) ?? null, error: null };
  }

  const builder = {
    select,
    eq,
    match,
    gte,
    order,
    limit,
    maybeSingle,
    then: <TResult1 = { data: Row[]; count?: number; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: Row[]; count?: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> => execSelect().then(onfulfilled, onrejected),
  };
  return builder;
}

export type SelectBuilder = ReturnType<typeof makeSelectBuilder>;

// ---------------------------------------------------------------------------
// Writes: insert / update / delete
// ---------------------------------------------------------------------------

/** Thenable helper so `await db.from('x').insert(...)` works. */
function asThen<T>(fn: () => Promise<T>): Promise<T> & { then: Promise<T>['then'] } {
  const p = fn();
  return p as Promise<T> & { then: Promise<T>['then'] };
}

function applyEqFilters(rows: { id: string; data: Row }[], filters: Filter[]): { id: string; data: Row }[] {
  return rows.filter((r) => filters.every((f) => (f.value === undefined ? true : r.data[f.field] === f.value)));
}

async function readAll(collectionName: string): Promise<{ id: string; data: Row }[]> {
  const snap = await getDocs(collection(firestore, collectionName));
  return snap.docs.map((d) => ({ id: d.id, data: toPlain(d.data()) as Row }));
}

function makeUpdateBuilder(collectionName: string, payload: Row) {
  const filters: Filter[] = [];
  const api = {
    eq(field: string, value: unknown) {
      filters.push({ field, op: '==', value });
      return api;
    },
    then<TResult1 = { error: null }, TResult2 = never>(
      onfulfilled?: ((value: { error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return asThen(async () => {
        const rows = applyEqFilters(await readAll(collectionName), filters);
        const clean = cleanPayload(payload);
        await Promise.all(rows.map((r) => updateDoc(doc(firestore, collectionName, r.id), clean)));
        return { error: null };
      }).then(onfulfilled, onrejected);
    },
  };
  return api;
}

function makeDeleteBuilder(collectionName: string) {
  const filters: Filter[] = [];
  const api = {
    eq(field: string, value: unknown) {
      filters.push({ field, op: '==', value });
      return api;
    },
    then<TResult1 = { error: null }, TResult2 = never>(
      onfulfilled?: ((value: { error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return asThen(async () => {
        const rows = applyEqFilters(await readAll(collectionName), filters);
        await Promise.all(rows.map((r) => deleteDoc(doc(firestore, collectionName, r.id))));
        return { error: null };
      }).then(onfulfilled, onrejected);
    },
  };
  return api;
}

function makeInsertThenable(collectionName: string, payload: Row | Row[]) {
  return asThen(async () => {
    const items = (Array.isArray(payload) ? payload : [payload]).map((p) => {
      const row = cleanPayload(p as Row);
      if (!('created_at' in row)) row.created_at = new Date().toISOString();
      return row;
    });
    const refs = await Promise.all(items.map((row) => addDoc(collection(firestore, collectionName), row)));
    const data = refs.map((ref, i) => ({ id: ref.id, ...items[i] }));
    return { data, error: null };
  });
}

// ---------------------------------------------------------------------------
// Realtime channels backed by onSnapshot
// ---------------------------------------------------------------------------

interface ChannelSub {
  event: string;
  table: string;
  cb: (payload: { new: Row }) => void;
}

function makeChannel() {
  const subs: ChannelSub[] = [];
  const api = {
    on(_type: string, filter: { event: string; table: string; schema?: string }, cb: (payload: { new: Row }) => void) {
      subs.push({ event: filter.event, table: filter.table, cb });
      return api;
    },
    subscribe() {
      // Agrupa por colecao: 1 onSnapshot por tabela.
      // Nao pula o snapshot inicial. Dedupe apenas dentro do mesmo snapshot
      // (StrictMode remonta e reemite 'added' inicial — isso é normal).
      const byTable = new Map<string, ChannelSub[]>();
      for (const s of subs) {
        const list = byTable.get(s.table) ?? [];
        list.push(s);
        byTable.set(s.table, list);
      }
      const unsubs = [...byTable.entries()].map(([table, list]) => {
        // A colecao de eventos (`eventos`/`events`) ja e carregada na inicializacao (`load`).
        // O `added` do PRIMEIRO snapshot nao deve disparar o callback (evita reloads
        // desnecessarios), mas os `added` seguintes (eventos novos) devem.
        const isEventTable = table === 'eventos' || table === 'events';
        let firstSnapshot = true;
        return onSnapshot(
          collection(firestore, table),
          { includeMetadataChanges: false },
          (snap) => {
            const skipAdded = isEventTable && firstSnapshot;
            firstSnapshot = false;
            const batchSeen = new Set<string>();
            for (const ch of snap.docChanges()) {
              const kind = ch.type;
              const batchKey = `${kind}:${ch.doc.id}`;
              if (batchSeen.has(batchKey)) continue;
              batchSeen.add(batchKey);

              // Ignora o `added` inicial de eventos (ja contem na load inicial).
              if (skipAdded && kind === 'added') continue;

              const plain = { id: ch.doc.id, ...(toPlain(ch.doc.data()) as Row) };
              // Normaliza docs das colecoes de evento para o formato EventRow
              // (`eventos` legado -> Contact ID; `events` -> schema atual).
              const rows: Row[] = table === 'eventos'
                ? (() => { try { return [normalizeLegacyEvento(ch.doc.id, plain)]; } catch { return []; } })()
                : table === 'events'
                  ? (() => { try { return [normalizeEventDoc(ch.doc.id, plain)]; } catch { return []; } })()
                  : [plain];
              for (const row of rows) {
                for (const s of list) {
                  const want = s.event;
                  const matchEv =
                    want === '*' ||
                    (want === 'INSERT' && kind === 'added') ||
                    (want === 'UPDATE' && kind === 'modified') ||
                    (want === 'DELETE' && kind === 'removed');
                  if (!matchEv) continue;
                  try {
                    s.cb({ new: row });
                  } catch (err) {
                    console.error('[realtime] cb error', table, want, err);
                  }
                }
              }
            }
          },
          (err) => {
            console.error('[realtime] onSnapshot error', table, err);
          },
        );
      });
      return { unsubscribe() { unsubs.forEach((u) => u()); } };
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Public entry point: db
// ---------------------------------------------------------------------------

export const db = {
  from(collectionName: string) {
    return {
      select: (columns = '*', options: { count?: string; head?: boolean } = {}) =>
        makeSelectBuilder(collectionName, columns, options),
      insert: (payload: Row | Row[]) => makeInsertThenable(collectionName, payload),
      update: (payload: Row) => makeUpdateBuilder(collectionName, payload),
      delete: () => makeDeleteBuilder(collectionName),
    };
  },
  channel(name: string) {
    void name;
    return makeChannel();
  },
  removeChannel(ch: { unsubscribe?: () => void } | null | undefined) {
    try {
      ch?.unsubscribe?.();
    } catch {
      /* noop */
    }
  },
};
