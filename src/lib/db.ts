import {
  Timestamp,
  addDoc, collection, deleteDoc, doc, getDocs,
  onSnapshot, updateDoc,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase';

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
// ---------------------------------------------------------------------------

/** Decodifica Contact ID 15/16 chars. */
function decodeBruto(bruto: string): { codigo: string; conta: string; qualificador: string; particao: string; zona: string } | null {
  const msg = (bruto ?? '').trim();
  if (msg.length !== 15 && msg.length !== 16) return null;
  if (msg.slice(4, 6) !== '18') return null;
  if (!/^[0-9A-Fa-f]+$/.test(msg)) return null;
  return {
    conta: msg.slice(0, 4),
    qualificador: msg[6],
    codigo: msg.slice(7, 10),
    particao: msg.slice(10, 12),
    zona: msg.slice(12, 15),
  };
}

const ALARM_CODES = new Set([
  '110', '111', '112', '113', '114', '115', '116', '117', '118',
  '120', '121', '122',
  '130', '131', '132', '133', '134', '146', '150',
]);

/**
 * Mesma regra de cores do front-end (src/lib/contactIdRules.ts):
 *   - alarme (qualificador 1 em codigos de incendio/panico/zona) -> vermelho, pulsa
 *   - restauracao (qualificador 3) -> verde, estatico
 *   - falha de energia/bateria (301/302) -> ambar, pulsa suave
 *   - armado/desarmado (401) -> informativo, estatico
 *   - online (602) -> verde, estatico
 */
function mapLegacyEvent(codigo: string, qualificador: string): { event_type: string; severity: string; state: string } {
  const q = String(qualificador ?? '');
  const cod = String(codigo ?? '');
  if (ALARM_CODES.has(cod)) {
    if (q === '3') return { event_type: 'alarm_restore', severity: 'normal', state: 'normal' };
    return { event_type: 'alarm', severity: 'critical', state: 'active' };
  }
  if (cod === '301' || cod === '302' || cod === '309' || cod === '351' || cod === '380') {
    if (q === '3') return { event_type: 'fault_restore', severity: 'normal', state: 'normal' };
    return { event_type: 'fault', severity: 'warning', state: 'active' };
  }
  if (cod === '401' || cod === '402') return { event_type: 'supervisory', severity: 'info', state: 'normal' };
  if (cod === '602') return { event_type: 'heartbeat', severity: 'info', state: 'normal' };
  if (q === '3') return { event_type: 'fault_restore', severity: 'normal', state: 'normal' };
  if (q === '6') return { event_type: 'heartbeat', severity: 'info', state: 'normal' };
  return { event_type: 'supervisory', severity: 'info', state: 'normal' };
}

type Row = Record<string, any>;

/**
 * Converte doc legado `eventos` -> EventRow (id prefixado com `leg-`).
 * O Contact ID (qualificador + codigo) e a fonte da verdade: o `event_type`
 * gravado no legado e apenas um palpite do receptor.
 */
export function normalizeLegacyEvento(id: string, leg: Record<string, any>): Row {
  const bruto = String(leg.bruto ?? '');
  const dec = decodeBruto(bruto);
  const codigo = String(leg.codigo ?? dec?.codigo ?? '');
  const conta = String(leg.conta ?? dec?.conta ?? '');
  // O `tipo` gravado pelo receptor ("evento" | "restauracao") e apenas um
  // palpite: o Contact ID (qualificador + codigo) manda. So usamos `tipo`
  // quando o qualificador nao veio nem no documento nem no bruto.
  const tipo = String(leg.tipo ?? '').toLowerCase();
  let qualificador = String(leg.qualificador ?? dec?.qualificador ?? '');
  if (!qualificador && tipo === 'restauracao') qualificador = '3';
  const particao = String(leg.particao ?? dec?.particao ?? '');
  const zona = String(leg.zona ?? dec?.zona ?? '');
  const mapped = mapLegacyEvent(codigo, qualificador);
  let received = '';
  const r = leg.recebido_em;
  if (typeof r === 'string') received = r;
  else {
    try {
      const p = toPlain(r) as unknown;
      if (typeof p === 'string') received = p;
    } catch { /* noop */ }
  }
  if (!received) received = new Date().toISOString();
  let zonaNum: number | null = null;
  const z = parseInt(zona, 10);
  if (Number.isFinite(z)) zonaNum = z;
  return {
    id: `leg-${id}`,
    tenant_id: (leg.tenant_id as string | null) ?? null,
    gateway_id: (leg.gateway_id as string | null) ?? null,
    building_id: (leg.building_id as string | null) ?? null,
    panel_id: (leg.panel_id as string | null) ?? null,
    input_id: null,
    external_event_id: `contactid-${bruto}`,
    sequence: null,
    // O Contact ID (qualificador + codigo) e a fonte da verdade: o `event_type`
    // gravado no documento e apenas um palpite do receptor e nao substitui a
    // regra de cores derivada do par (qualificador, codigo).
    event_type: mapped.event_type,
    state: mapped.state,
    input_ref: zona ? `Z${zona}` : null,
    occurred_at: received,
    received_at: received,
    acknowledged: false,
    acknowledged_by: null,
    acknowledged_at: null,
    severity: mapped.severity,
    origem_ip: (leg.origem_ip as string | null) ?? null,
    conta: conta || null,
    codigo_contato: codigo || null,
    qualificador: qualificador || null,
    particao: particao || null,
    zona: zona || null,
    descricao: (leg.descricao as string | null) ?? null,
    bruto,
    input_number: zonaNum,
  };
}

/**
 * Busca a colecao `eventos` (fonte unica de verdade dos eventos do receptor).
 *
 * Os documentos sao normalizados para o formato EventRow e deduplicados pelo
 * Contact ID (`external_event_id`), mantendo sempre o documento mais recente
 * (mesmo `bruto` pode ter sido gravado mais de uma vez).
 */
export async function fetchAllEvents(limitN = 500): Promise<Row[]> {
  const { getDocs: gds, collection: col } = await import('firebase/firestore');
  const { firestore: fs } = await import('@/lib/firebase');
  const snap = await gds(col(fs, 'eventos')).catch(() => ({ docs: [] as { id: string; data: () => Row }[] }));
  const rows: Row[] = [];
  for (const d of (snap as { docs: { id: string; data: () => Row }[] }).docs) {
    try {
      rows.push(normalizeLegacyEvento(d.id, (toPlain(d.data()) as Row) ?? {}));
    } catch { /* ignora doc invalido */ }
  }
  // Mais recentes primeiro: assim a deduplicacao mantem a ultima versao do evento.
  rows.sort((x, y) => String(y.received_at ?? '').localeCompare(String(x.received_at ?? '')));
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const key = String(r.external_event_id ?? r.bruto ?? r.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.slice(0, limitN);
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
        // A colecao de eventos (`eventos`) ja e carregada na inicializacao (`load`).
        // O `added` do PRIMEIRO snapshot nao deve disparar o callback (evita reloads
        // desnecessarios), mas os `added` seguintes (eventos novos) devem.
        const isEventTable = table === 'eventos';
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
              // Normaliza docs da colecao `eventos` para o formato EventRow
              const rows: Row[] = table === 'eventos'
                ? (() => { try { return [normalizeLegacyEvento(ch.doc.id, plain)]; } catch { return []; } })()
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
