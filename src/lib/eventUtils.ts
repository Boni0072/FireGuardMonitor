/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Logica pura da fonte unificada de eventos.
 *
 * Este modulo nao importa nada do Firebase: e testavel isoladamente e pode
 * ser usado por scripts (verificacao, migracao) sem inicializar o SDK.
 *
 * Regras:
 *   - `events` (nova) e `eventos` (legada) sao normalizadas para o MESMO
 *     formato EventRow.
 *   - O Contact ID (par qualificador + codigo) e a fonte da verdade do
 *     `event_type`; o campo `tipo` gravado pelo receptor legado e apenas um
 *     palpite.
 *   - Eventos sem `tenant_id`/`building_id` herdam o vinculo do painel.
 *   - O mesmo evento gravado nas DUAS colecoes e deduplicado; eventos
 *     distintos que compartilham Contact ID (ex.: heartbeat periodico) sao
 *     preservados.
 *   - O resultado e ordenado do mais recente para o mais antigo.
 */

export type EventRowLike = Record<string, any>;

/** Decodifica Contact ID 15/16 chars. */
export function decodeBruto(bruto: string): { codigo: string; conta: string; qualificador: string; particao: string; zona: string } | null {
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
export function mapLegacyEvent(codigo: string, qualificador: string): { event_type: string; severity: string; state: string } {
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


/**
 * Janela (em ms) usada para agrupar ocorrencias do MESMO evento.
 *
 * O receptor grava o mesmo evento em DUAS colecoes (`events` e `eventos`) na
 * mesma gravacao, entao os timestamps diferem apenas pelo tempo de rede
 * (poucos segundos). Ja um heartbeat reenviado pelo painel (mesmo Contact ID,
 * mesmo codigo/qualificador) e um evento NOVO e chega com intervalo maior.
 */
export const EVENT_DEDUPE_WINDOW_MS = 20_000;

/**
 * Chave de deduplicacao de um evento.
 *
 * Prioridade: `external_event_id` (Contact ID) > payload bruto (`bruto`) >
 * id do documento. O mesmo evento gravado nas colecoes `events` e `eventos`
 * (ou reenviado pelo receptor) produz a MESMA chave, entao e deduplicado.
 * Eventos sem nenhum identificador caem no id do documento (prefixado por
 * colecao, para nao colidirem entre `events` e `eventos`).
 */
export function eventDedupeKey(evt: {
  external_event_id?: string | null;
  bruto?: string | null;
  id?: string | null;
}): string {
  const raw = String(evt.external_event_id ?? evt.bruto ?? '').trim();
  if (raw) return raw;
  return `id-${String(evt.id ?? '')}`;
}

/** Timestamp do evento em ms (epoch). `null` quando ausente/invalido. */
export function eventTimestampMs(evt: { received_at?: string | null }): number | null {
  const raw = String(evt.received_at ?? '').trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Duas linhas representam a MESMA ocorrencia do mesmo evento?
 *
 * - Mesma chave de deduplicacao (Contact ID / bruto / id), e
 * - timestamps dentro da janela `EVENT_DEDUPE_WINDOW_MS`.
 *
 * Sem timestamp confiavel em uma das linhas, considera a mesma ocorrencia
 * (evita duplicar evento ja carregado por nao ter `received_at`).
 */
export function isSameEventOccurrence(
  a: { external_event_id?: string | null; bruto?: string | null; id?: string | null; received_at?: string | null },
  b: { external_event_id?: string | null; bruto?: string | null; id?: string | null; received_at?: string | null },
  windowMs: number = EVENT_DEDUPE_WINDOW_MS,
): boolean {
  if (eventDedupeKey(a) !== eventDedupeKey(b)) return false;
  const ta = eventTimestampMs(a);
  const tb = eventTimestampMs(b);
  if (ta == null || tb == null) return true;
  return Math.abs(ta - tb) <= windowMs;
}

/**
 * Agrupa ocorrencias do MESMO evento e devolve uma linha por grupo.
 *
 * - O receptor grava o mesmo evento em `events` E `eventos` (poucos segundos
 *   de diferenca) -> colapsam em UM evento.
 * - Um heartbeat reenviado pelo painel (mesmo Contact ID, mas com intervalo
 *   maior que a janela) e um evento NOVO -> permanece.
 *
 * Na conflito de representacao, ganha a linha mais recente; em empate, a da
 * colecao `events` (schema mais completo: acknowledgement, panel_id).
 */
export function dedupeEventRows<T extends EventRowLike>(rows: T[]): T[] {
  const groups: T[][] = [];
  for (const r of rows) {
    let target: T[] | null = null;
    for (const g of groups) {
      if (isSameEventOccurrence(g[0], r)) { target = g; break; }
    }
    if (target) target.push(r);
    else groups.push([r]);
  }

  return groups.map((g) => {
    let best = g[0];
    for (const r of g.slice(1)) {
      const cmp = String(r.received_at ?? '').localeCompare(String(best.received_at ?? ''));
      if (cmp > 0) { best = r; continue; }
      if (cmp < 0) continue;
      if (r.__source === 'events' && best.__source !== 'events') best = r;
    }
    return best;
  });
}

/** Ordena do mais recente para o mais antigo (empate resolvido pelo id). */
export function sortEventsNewestFirst<T extends EventRowLike>(rows: T[]): T[] {
  rows.sort((a, b) => {
    const cmp = String(b.received_at ?? '').localeCompare(String(a.received_at ?? ''));
    if (cmp !== 0) return cmp;
    return String(a.id).localeCompare(String(b.id));
  });
  return rows;
}

/**
 * Converte doc legado `eventos` -> EventRow (id prefixado com `leg-`).
 * O Contact ID (qualificador + codigo) e a fonte da verdade: o `tipo` gravado
 * pelo receptor legado e apenas um palpite.
 */
export function normalizeLegacyEvento(id: string, leg: EventRowLike): EventRowLike {
  const bruto = String(leg.bruto ?? '');
  const dec = decodeBruto(bruto);
  const codigo = String(leg.codigo ?? dec?.codigo ?? '');
  const conta = String(leg.conta ?? dec?.conta ?? '');
  // O `tipo` gravado pelo receptor ("evento" | "restauracao") e apenas um
  // palpite: o Contact ID (qualificador + codigo) manda. So usamos `tipo`
  // quando o qualificador nao veio nem no documento nem do bruto.
  const tipo = String(leg.tipo ?? '').toLowerCase();
  let qualificador = String(leg.qualificador ?? dec?.qualificador ?? '');
  if (!qualificador && tipo === 'restauracao') qualificador = '3';
  const particao = String(leg.particao ?? dec?.particao ?? '');
  const zona = String(leg.zona ?? dec?.zona ?? '');
  const mapped = mapLegacyEvent(codigo, qualificador);
  let received = '';
  const r = leg.recebido_em;
  if (typeof r === 'string') received = r;
  else if (r instanceof Date) received = r.toISOString();
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
    // Sem `bruto` nao ha Contact ID: usa o id do documento para nao colidir
    // com outros eventos legados sem payload.
    external_event_id: bruto ? `contactid-${bruto}` : null,
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
 * Normaliza um documento da colecao `events` (formato atual do receptor) para
 * o formato EventRow, preenchendo os campos ausentes com valores seguros.
 */
export function normalizeEventDoc(id: string, doc: EventRowLike): EventRowLike {
  const bruto = String(doc.bruto ?? '');
  const occurred = String(doc.occurred_at ?? doc.recebido_em ?? doc.received_at ?? '') || new Date().toISOString();
  const received = String(doc.received_at ?? doc.recebido_em ?? doc.occurred_at ?? '') || occurred;
  const qualificador = doc.qualificador != null ? String(doc.qualificador) : null;
  const codigo = doc.codigo_contato != null ? String(doc.codigo_contato) : (doc.codigo != null ? String(doc.codigo) : null);
  const conta = doc.conta != null ? String(doc.conta) : null;
  const zona = doc.zona != null ? String(doc.zona) : null;
  const external = (doc.external_event_id as string | null) ?? (bruto ? `contactid-${bruto}` : null);
  let zonaNum: number | null = null;
  if (zona != null) {
    const z = parseInt(zona, 10);
    if (Number.isFinite(z)) zonaNum = z;
  }
  if (doc.input_number != null && Number.isFinite(Number(doc.input_number))) zonaNum = Number(doc.input_number);
  return {
    id,
    tenant_id: (doc.tenant_id as string | null) ?? null,
    gateway_id: (doc.gateway_id as string | null) ?? null,
    building_id: (doc.building_id as string | null) ?? null,
    panel_id: (doc.panel_id as string | null) ?? null,
    input_id: (doc.input_id as string | null) ?? null,
    external_event_id: external,
    sequence: (doc.sequence as number | null) ?? null,
    event_type: String(doc.event_type ?? 'supervisory'),
    state: String(doc.state ?? 'normal'),
    input_ref: (doc.input_ref as string | null) ?? (zona ? `Z${zona}` : null),
    occurred_at: occurred,
    received_at: received,
    acknowledged: doc.acknowledged === true,
    acknowledged_by: (doc.acknowledged_by as string | null) ?? null,
    acknowledged_at: (doc.acknowledged_at as string | null) ?? null,
    severity: String(doc.severity ?? 'info'),
    origem_ip: (doc.origem_ip as string | null) ?? null,
    conta,
    codigo_contato: codigo,
    qualificador,
    particao: doc.particao != null ? String(doc.particao) : null,
    zona,
    descricao: (doc.descricao as string | null) ?? null,
    bruto: bruto || null,
    input_number: zonaNum,
  };
}

/** Vinculo (tenant/building) herdado do painel, para eventos sem esse dado. */
export interface PanelLink {
  tenant_id: string | null;
  building_id: string | null;
}

/**
 * Aplica o vinculo herdado do painel e normaliza o evento.
 *
 * - Documentos da colecao `events`: herdam `tenant_id`/`building_id` do painel
 *   quando nao os trazem.
 * - Documentos da colecao `eventos` (legado): alem disso, herdam o `panel_id`
 *   resolvido pela `conta` (asset_code) ou pelo `origem_ip` (ip_data).
 */
export function linkEventToPanel(
  row: EventRowLike,
  panelInfo: Map<string, PanelLink>,
  resolvePanel?: (row: EventRowLike) => string | null,
): EventRowLike {
  const out = { ...row };
  if (!out.panel_id && resolvePanel) {
    const pid = resolvePanel(out);
    if (pid) out.panel_id = pid;
  }
  if (out.panel_id) {
    const info = panelInfo.get(String(out.panel_id));
    if (info) {
      if (!out.tenant_id) out.tenant_id = info.tenant_id;
      if (!out.building_id) out.building_id = info.building_id;
    }
  }
  return out;
}
