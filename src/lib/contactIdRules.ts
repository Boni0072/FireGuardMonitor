/**
 * ---------------------------------------------------------------------------
 * Regra de cores por codigo Contact ID (qualificador + codigo)
 * ---------------------------------------------------------------------------
 *
 * O par (qualificador, codigo) define o significado real do evento. E ele que
 * manda na cor exibida na interface e na decisao de pulsar ou nao:
 *
 *   (1, "130")  Disparo de zona        -> VERMELHO  (pulsa)
 *   (1, "110")  Incendio                -> VERMELHO  (pulsa)
 *   (1, "120")  Panico                  -> VERMELHO  (pulsa)
 *   (3, "130")  Restauracao de zona     -> VERDE     (estatico)
 *   (3, "110")  Restauracao de incendio -> VERDE     (estatico)
 *   (3, "301")  Retorno de energia AC   -> VERDE     (estatico)
 *   (1, "301")  Falta de energia AC     -> AMBAR     (pulsa suave)
 *   (1, "302")  Bateria baixa           -> AMBAR     (pulsa suave)
 *   (1, "401")  Armado/desarmado        -> AZUL      (informativo, estatico)
 *   (1, "602")  Online                   -> VERDE     (estatico, nunca pulsa)
 *
 * Regras gerais:
 *   - Alarme (qualificador 1 em codigos de incendio/panico/zona) = vermelho pulsante.
 *   - Restauracao (qualificador 3) = verde estatico.
 *   - Online (602) = verde estatico.
 *   - Falhas de energia/bateria (301/302) = ambar com pulsacao discreta.
 */

export type ContactIdTone = 'critical' | 'warning' | 'ok' | 'info';

export interface ContactIdRule {
  /** Identificador unico da regra (ex.: 'disparo_zona'). */
  key: string;
  qualificador: string;
  codigo: string;
  /** Rotulo exibido no badge. */
  label: string;
  /** Tom de cor (vermelho / ambar / verde / azul). */
  tone: ContactIdTone;
  /** true = o elemento deve pulsar; false = sempre estatico. */
  pulse: boolean;
}

/** Regras explicitas, na ordem de prioridade. */
export const CONTACT_ID_RULES: ContactIdRule[] = [
  { key: 'disparo_zona',         qualificador: '1', codigo: '130', label: 'Disparo de zona',         tone: 'critical', pulse: true },
  { key: 'restauracao_zona',     qualificador: '3', codigo: '130', label: 'Restauracao de zona',     tone: 'ok',       pulse: false },
  { key: 'incendio',             qualificador: '1', codigo: '110', label: 'Incendio',                 tone: 'critical', pulse: true },
  { key: 'restauracao_incendio', qualificador: '3', codigo: '110', label: 'Restauracao de incendio', tone: 'ok',       pulse: false },
  { key: 'panico',               qualificador: '1', codigo: '120', label: 'Panico',                   tone: 'critical', pulse: true },
  { key: 'restauracao_panico',   qualificador: '3', codigo: '120', label: 'Restauracao de panico',   tone: 'ok',       pulse: false },
  { key: 'armado_desarmado',     qualificador: '1', codigo: '401', label: 'Armado/desarmado',         tone: 'info',     pulse: false },
  { key: 'desarmado',            qualificador: '3', codigo: '401', label: 'Desarmado',                tone: 'ok',       pulse: false },
  { key: 'falta_energia_ac',     qualificador: '1', codigo: '301', label: 'Falta de energia AC',      tone: 'warning',  pulse: true },
  { key: 'retorno_energia_ac',   qualificador: '3', codigo: '301', label: 'Retorno de energia AC',    tone: 'ok',       pulse: false },
  { key: 'bateria_baixa',        qualificador: '1', codigo: '302', label: 'Bateria baixa',            tone: 'warning',  pulse: true },
  { key: 'restauracao_bateria',  qualificador: '3', codigo: '302', label: 'Bateria restaurada',      tone: 'ok',       pulse: false },
  { key: 'online',               qualificador: '1', codigo: '602', label: 'Online',                   tone: 'ok',       pulse: false },
  { key: 'online_status',        qualificador: '6', codigo: '602', label: 'Online',                   tone: 'ok',       pulse: false },
];

/**
 * Familia de codigos: usada quando nao ha regra exata, mas o codigo pertence
 * a uma familia conhecida (ex.: 111-115 sao fumaca/combustao -> vermelho).
 */
const CODE_FAMILY: Array<{ codes: string[]; qualificador: string; tone: ContactIdTone; pulse: boolean; label: string }> = [
  { codes: ['111', '112', '113', '114', '115', '116', '117', '118'], qualificador: '1', tone: 'critical', pulse: true,  label: 'Alarme de incendio' },
  { codes: ['111', '112', '113', '114', '115', '116', '117', '118'], qualificador: '3', tone: 'ok',       pulse: false, label: 'Restauracao de alarme' },
  { codes: ['121', '122'],                                              qualificador: '1', tone: 'critical', pulse: true,  label: 'Panico' },
  { codes: ['131', '132', '133', '134', '146', '150'],                    qualificador: '1', tone: 'critical', pulse: true,  label: 'Disparo de zona' },
  { codes: ['131', '132', '133', '134', '146', '150'],                    qualificador: '3', tone: 'ok',       pulse: false, label: 'Restauracao de zona' },
  { codes: ['309', '351', '380'],                                        qualificador: '1', tone: 'warning',  pulse: true,  label: 'Falha de supervision' },
  { codes: ['309', '351', '380'],                                        qualificador: '3', tone: 'ok',       pulse: false, label: 'Restauracao de supervision' },
];

/** Resolve a regra pelo par (qualificador, codigo). Retorna null se nao houver. */
export function resolveContactIdRule(qualificador: string | null | undefined, codigo: string | null | undefined): ContactIdRule | null {
  const q = String(qualificador ?? '').trim();
  const cod = String(codigo ?? '').trim();
  if (!cod) return null;

  const exata = CONTACT_ID_RULES.find((r) => r.codigo === cod && r.qualificador === q);
  if (exata) return exata;

  // "Online" (602) e verde estatico, aconteca qual for o qualificador.
  if (cod === '602') return CONTACT_ID_RULES.find((r) => r.key === 'online')!;

  const fam = CODE_FAMILY.find((f) => f.codes.includes(cod) && f.qualificador === q);
  if (fam) {
    return { key: `${cod}_${q}`, qualificador: q, codigo: cod, label: fam.label, tone: fam.tone, pulse: fam.pulse };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classes de cor por tom (tema claro e tema escuro do Monitor)
// ---------------------------------------------------------------------------

export const TONE_BADGE_LIGHT: Record<ContactIdTone, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  warning: 'bg-amber-100 text-amber-700 border border-amber-200',
  ok: 'bg-green-100 text-green-700 border border-green-200',
  info: 'bg-blue-100 text-blue-700 border border-blue-200',
};

export const TONE_BADGE_DARK: Record<ContactIdTone, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/40',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  ok: 'bg-green-500/15 text-green-400 border-green-500/40',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/40',
};

export const TONE_TEXT_DARK: Record<ContactIdTone, string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
  ok: 'text-green-400',
  info: 'text-blue-400',
};

export const TONE_DOT_DARK: Record<ContactIdTone, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  ok: 'bg-green-500',
  info: 'bg-blue-500',
};

/** Classe de animacao conforme a regra (verde/azul nunca pulsam). */
export function tonePulseClass(tone: ContactIdTone, pulse: boolean): string {
  if (!pulse) return '';
  return tone === 'critical' ? 'blink-critical' : 'blink-attention';
}

// ---------------------------------------------------------------------------
// Resolucao por evento da aplicacao
// ---------------------------------------------------------------------------

export interface EventLike {
  event_type?: string | null;
  severity?: string | null;
  qualificador?: string | null;
  codigo_contato?: string | null;
  codigo?: string | null;
  zona?: string | null;
  input_ref?: string | null;
  descricao?: string | null;
}

/**
 * Descobre o tom do evento.
 * Prioridade: par (qualificador, codigo) do Contact ID; depois event_type; por fim severity.
 */
export function resolveEventTone(evt: EventLike): { tone: ContactIdTone; pulse: boolean; rule: ContactIdRule | null } {
  const qualificador = evt.qualificador ?? null;
  const codigo = evt.codigo_contato ?? evt.codigo ?? null;
  const rule = resolveContactIdRule(qualificador, codigo);
  if (rule) return { tone: rule.tone, pulse: rule.pulse, rule };

  switch (evt.event_type) {
    case 'alarm':
      return { tone: 'critical', pulse: true, rule: null };
    case 'fault':
    case 'gateway_fault':
      return { tone: 'warning', pulse: true, rule: null };
    case 'comm_loss':
      return { tone: 'warning', pulse: true, rule: null };
    case 'alarm_restore':
    case 'fault_restore':
    case 'comm_restore':
      return { tone: 'ok', pulse: false, rule: null };
    case 'heartbeat':
      return { tone: 'ok', pulse: false, rule: null };
    case 'supervisory':
      return { tone: 'info', pulse: false, rule: null };
    default:
      break;
  }
  switch (evt.severity) {
    case 'critical': return { tone: 'critical', pulse: true, rule: null };
    case 'warning': return { tone: 'warning', pulse: true, rule: null };
    case 'normal': return { tone: 'ok', pulse: false, rule: null };
    default: return { tone: 'info', pulse: false, rule: null };
  }
}

/** Rotulo preferindo a regra de Contact ID e caindo para o rotulo do evento. */
export function resolveEventLabel(evt: EventLike, fallback: string): string {
  const qualificador = evt.qualificador ?? null;
  const codigo = evt.codigo_contato ?? evt.codigo ?? null;

  // Caso especifico: evento SPJ de falta de energia AC (codigo 301, qualificador 1)
  // da zona Z005 deve exibir "Falta de energia AC".
  // Outros eventos da zona Z005 (ex.: disparo de zona codigo 130) mantem sua
  // classificacao normal pelo Contact ID.
  const zona = String(evt.zona ?? '').trim();
  const inputRef = String(evt.input_ref ?? '').trim().toUpperCase();
  const isZ005 = zona === '005' || inputRef === 'Z005' || inputRef === 'Z5';
  const isFaltaEnergiaAC = qualificador === '1' && codigo === '301';
  if (isZ005 && isFaltaEnergiaAC) {
    return 'Falta de energia AC';
  }

  const rule = resolveContactIdRule(qualificador, codigo);
  if (rule) return rule.label;
  return fallback;
}
