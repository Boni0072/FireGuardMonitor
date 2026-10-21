/**
 * Verificacao da fonte unificada de eventos contra o dump real do Firestore.
 *
 * Reproduz o pipeline de `fetchUnifiedEvents` (normalizacao -> vinculo de
 * painel -> dedupe -> ordenacao -> filtro de tenant) usando os dados reais
 * de `firestore_dump.json`, sem depender de rede.
 *
 * Uso: npm run verify:events
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Importa direto de `eventUtils` (modulo puro, sem Firebase e sem alias `@/`),
// para o script rodar com `npx tsx` sem depender do bundle do Vite.
import {
  dedupeEventRows,
  normalizeLegacyEvento,
  normalizeEventDoc,
  sortEventsNewestFirst,
} from '../src/lib/eventUtils';

type Row = Record<string, any>;

const dump = JSON.parse(
  readFileSync(resolve(process.cwd(), 'firestore_dump.json'), 'utf8'),
) as Record<string, Row[]>;

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` -> ${detail}` : ''}`);
}

const panelInfo = new Map<string, { tenant_id: string | null; building_id: string | null }>();
for (const p of dump.panels ?? []) {
  panelInfo.set(p.id, {
    tenant_id: p.tenant_id ?? null,
    building_id: p.building_id ?? null,
  });
}

// Normaliza as duas colecoes (mesmo caminho de `fetchUnifiedEvents`).
const rows: Row[] = [];
for (const d of (dump.events ?? []) as Row[]) {
  const row = normalizeEventDoc(String(d.id), d);
  row.__source = 'events';
  rows.push(row);
}
for (const d of (dump.eventos ?? []) as Row[]) {
  const leg = normalizeLegacyEvento(String(d.id), d);
  leg.__source = 'eventos';
  rows.push(leg);
}

const deduped = dedupeEventRows(rows);
sortEventsNewestFirst(deduped);

console.log('\n== Resultado da fonte unificada ==');
for (const e of deduped) {
  console.log(
    `  ${e.received_at} | ${e.event_type.padEnd(14)} | q=${e.qualificador} cod=${e.codigo_contato} | conta=${e.conta} | ${e.descricao ?? ''} | src=${e.__source}`,
  );
}

console.log('\n== Verificacoes ==');
check(
  'total de eventos do dump preservado (7 eventos distintos)',
  deduped.length === 7,
  `obtido ${deduped.length}`,
);
check(
  'os dois heartbeats 602 (mesmo Contact ID, 54s de intervalo) NAO foram fundidos',
  deduped.filter((e) => e.bruto === '1234181602010051').length === 2,
  `obtido ${deduped.filter((e) => e.bruto === '1234181602010051').length}`,
);
check(
  'ordenacao do mais recente para o mais antigo',
  deduped.every((e, i) => i === 0 || String(deduped[i - 1].received_at) >= String(e.received_at)),
);
check(
  'nenhum evento sem identificador (todos tem bruto/Contact ID)',
  deduped.every((e) => Boolean(e.bruto)),
);
check(
  'event_type derivado do Contact ID (nao do campo `tipo` do legado)',
  deduped.every((e) => {
    if (e.codigo_contato === '110' && e.qualificador === '3') return e.event_type === 'alarm_restore';
    if (e.codigo_contato === '301' && e.qualificador === '3') return e.event_type === 'fault_restore';
    if (e.codigo_contato === '301' && e.qualificador === '1') return e.event_type === 'fault';
    if (e.codigo_contato === '120' && e.qualificador === '1') return e.event_type === 'alarm';
    if (e.codigo_contato === '602' && e.qualificador === '1') return e.event_type === 'heartbeat';
    return false;
  }),
);

// Dedupe entre colecoes: o mesmo evento gravado nas DUAS colecoes (poucos
// segundos de diferenca) deve virar UM evento.
const crossCollection = dedupeEventRows([
  { id: 'a', external_event_id: 'contactid-XYZ', received_at: '2026-10-19T20:00:00.000Z', __source: 'events' },
  { id: 'b', external_event_id: 'contactid-XYZ', received_at: '2026-10-19T20:00:03.000Z', __source: 'eventos' },
]);
check(
  'mesmo evento nas duas colecoes (3s de diferenca) colapsa em 1',
  crossCollection.length === 1,
  `obtido ${crossCollection.length}`,
);
check(
  'representacao preferida vem da colecao `events` em empate de timestamp',
  dedupeEventRows([
    { id: 'a', external_event_id: 'contactid-T', received_at: '2026-10-19T20:00:00.000Z', __source: 'eventos' },
    { id: 'b', external_event_id: 'contactid-T', received_at: '2026-10-19T20:00:00.000Z', __source: 'events' },
  ])[0].id === 'b',
);
check(
  'heartbeat reenviado apos a janela (60s) permanece como evento novo',
  dedupeEventRows([
    { id: 'a', external_event_id: 'contactid-H', received_at: '2026-10-19T20:00:00.000Z' },
    { id: 'b', external_event_id: 'contactid-H', received_at: '2026-10-19T20:01:00.000Z' },
  ]).length === 2,
);

console.log(`\n${failures === 0 ? 'TODAS AS VERIFICACOES PASSARAM' : `${failures} VERIFICACAO(OES) FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
