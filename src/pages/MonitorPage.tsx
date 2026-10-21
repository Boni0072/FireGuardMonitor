import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, Panel, Gateway, Building, EventRow, isDemoAccount, fetchAllEvents } from '@/lib/db';
import { Modal } from '@/components/Modal';
import {
  CircuitBoard, Flame, AlertTriangle, Wifi, WifiOff, Building2,
  Activity, ShieldCheck, Radio, MapPin, Clock, Cpu, ToggleRight,
  X, RefreshCw, Search, ChevronDown, Volume2, VolumeX,
} from 'lucide-react';
import { EVENT_LABELS, eventTypeColor, formatDateTime, formatTime, timeAgo, eventBadgeLabel, eventLabelFor, eventBadgeDark } from '@/lib/eventHelpers';
import {
  resolveEventTone,
  type ContactIdTone,
} from '@/lib/contactIdRules';
import { reconcilePanelState, type PanelEvent } from '@/lib/eventReconcile';

type PanelStatus = 'alarm' | 'fault' | 'online' | 'offline' | 'unknown';

interface PanelBoard {
  panel: Panel;
  building: Building | null;
  gateway: Gateway | null;
  status: PanelStatus;
  /** Tom de cor conforme a regra de cores por codigo Contact ID. */
  tone: ContactIdTone;
  /** Eventos que estao realmente ativos (reconciliados). */
  activeEvents: EventRow[];
  lastEvent: EventRow | null;
  /** Evento que motiva o status atual (alarme ativo / falha ativa / ultimo evento). */
  statusEvent: EventRow | null;
  activeAlarmCount: number;
  faultCount: number;
  recentEvents: EventRow[];
  imageUrl?: string;
}

export function MonitorPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const isDemo = isDemoAccount(profile?.email);

  const [boards, setBoards] = useState<PanelBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterBuilding, setFilterBuilding] = useState<string>('');
  const [detail, setDetail] = useState<PanelBoard | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [simulationMode, setSimulationMode] = useState(false);
  const [search, setSearch] = useState('');
  const [now, setNow] = useState<Date>(new Date());
  const [soundEnabled, setSoundEnabled] = useState(true);
  const alarmAudioRef = useRef<AudioContext | null>(null);
  // Refs estaveis para o callback realtime nao depender de profile/isPlatformAdmin
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const isPlatformAdminRef = useRef(isPlatformAdmin);
  isPlatformAdminRef.current = isPlatformAdmin;
  // Polling leve anti-congelamento: a cada 10s re-sincroniza o ultimo evento.
  // Nao substitui o realtime; apenas garante que a tela nunca fique presa.
  const pollGuard = useRef(false);
  async function pollLatest() {
    if (pollGuard.current || document.hidden) return;
    pollGuard.current = true;
    try {
      const rows = await fetchAllEvents(200);
      const mine = !isPlatformAdminRef.current && profileRef.current?.tenant_id
        ? rows.filter((r) => {
          const t = r.tenant_id as string | null;
          return t == null || t === '' || t === profileRef.current?.tenant_id;
        })
        : rows;
      if (mine.length === 0) return;
      const newest = (mine as EventRow[]).slice().sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')))[0];
      setBoards((prev) => {
        if (prev.length === 0) return prev;
        // Se algum board ja tem esse evento como lastEvent, nada a fazer
        const already = prev.some((b) => b.lastEvent?.id === newest.id || b.recentEvents.some((e) => e.id === newest.id && e.received_at === newest.received_at));
        if (already) return prev;
        void loadRef.current();
        return prev;
      });
    } catch { /* silencioso */ } finally {
      pollGuard.current = false;
    }
  }
  const loadRef = useRef(load);
  loadRef.current = load;

  async function load() {
    if (isDemo) { loadDemo(); return; }
    setLoading(true);
    const tenantFilter: Record<string, string> = isPlatformAdmin || !profile?.tenant_id ? {} : { tenant_id: profile.tenant_id };

    const [panelRes, gwRes, bldRes] = await Promise.all([
      db.from('panels').select('*').match(tenantFilter as Record<string, string>).order('manufacturer'),
      db.from('gateways').select('*').match(tenantFilter as Record<string, string>),
      db.from('buildings').select('*').match(tenantFilter as Record<string, string>),
    ]);

    const panels = (panelRes.data ?? []) as Panel[];
    const gateways = (gwRes.data ?? []) as Gateway[];
    const buildings = (bldRes.data ?? []) as Building[];

    // Get latest event per panel (evento atual, unificado events + eventos legada).
    // Inclui eventos com tenant_id null (centrais sem empresa vinculada).
    let filtered = ((await fetchAllEvents(500)) as EventRow[])
      .sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')));
    if (!isPlatformAdmin && profile?.tenant_id) {
      filtered = filtered.filter((e) => e.tenant_id == null || e.tenant_id === '' || e.tenant_id === profile.tenant_id);
    } else if (Object.keys(tenantFilter).length > 0) {
      filtered = filtered.filter((e) => e.tenant_id == null || e.tenant_id === '' || (tenantFilter.tenant_id != null && e.tenant_id === tenantFilter.tenant_id));
    }
    const allEvents = filtered;

    const built: PanelBoard[] = panels.map((panel) => {
      const building = buildings.find((b) => b.id === panel.building_id) ?? null;
      const gateway = gateways.find((g) => g.panel_id === panel.id) ?? null;
      // Evento atual: filtra por panel_id OU (sem vinculo) por conta da central.
      // A conta (Contact ID) tem precedencia sobre o IP: um mesmo IP (ex.:
      // 127.0.0.1 do simulador) pode atender mais de uma central e, se o IP
      // fosse usado em conjunto, o evento apareceria em cards errados.
      const panelEvents = allEvents
        .filter((e) => {
          if (e.panel_id != null && e.panel_id !== '') return e.panel_id === panel.id;
          if (e.conta != null && e.conta !== '') {
            return String(e.conta) === String(panel.asset_code ?? '');
          }
          return e.origem_ip != null && e.origem_ip !== '' && String(panel.ip_data ?? '').includes(String(e.origem_ip));
        })
        .sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')));
      // Reconcilia os eventos pela regra de cores do Contact ID:
      // restauracao (qualificador 3) cancela o disparo; online (602) = verde estatico.
      const state = reconcilePanelState(panelEvents as unknown as PanelEvent[]);

      let status: PanelStatus = 'unknown';
      if (state.hasActiveAlarm) status = 'alarm';
      else if (state.hasActiveFault) status = 'fault';
      else if (gateway) {
        if (gateway.status === 'online') status = 'online';
        else if (gateway.status === 'offline') status = 'offline';
        else if (gateway.status === 'degraded') status = 'fault';
        else status = 'unknown';
      } else if (state.hasOnline) {
        // Sem gateway cadastrado, mas a central reportou "Online" (602):
        // ela esta operacional.
        status = 'online';
      }

      return {
        panel, building, gateway, status,
        tone: state.tone,
        activeEvents: state.activeEvents as unknown as EventRow[],
        lastEvent: panelEvents[0] ?? null,
        statusEvent: (state.statusEvent as unknown as EventRow) ?? null,
        activeAlarmCount: state.activeAlarmCount,
        faultCount: state.faultCount,
        recentEvents: panelEvents.slice(0, 8),
      };
    });

    setBoards(built);
    setLastUpdate(new Date());
    setLoading(false);
    if (simulationMode) setSimulationMode(false);
  }

  function loadDemo() {
    setLoading(true);
    setBoards(createSimulationBoards());
    setLastUpdate(new Date());
    setLoading(false);
    setSimulationMode(true);
  }

  useEffect(() => { load(); }, [profile, isPlatformAdmin]);

  function createSimulationBoards(): PanelBoard[] {
    const names = [
      ['Ed. Comercial Alpha', 'Intelbras', 'CIE 1125'], ['Hospital São Lucas', 'NOTIFIER', 'NFS2-320'],
      ['Shopping Center', 'Siemens', 'FC723'], ['Ed. Residencial Jardim', 'Bosch', 'FPA-5000'],
      ['Indústria Têxtil', 'Segurimax', 'SFT-2000'], ['Escola Municipal', 'Intelbras', 'CIE 1125'],
      ['Ed. Corporativo Beta', 'NOTIFIER', 'NFS2-320'], ['Hospital Villa Nova', 'Bosch', 'FPA-5000'],
      ['Centro Logístico', 'Siemens', 'FC723'], ['Shopping Plaza', 'Intelbras', 'CIE 1125'],
      ['Unidade Operacional', 'Segurimax', 'SFT-2000'], ['Ed. Financeiro', 'Bosch', 'FPA-5000'],
      ['Clínica Médica', 'NOTIFIER', 'NFS2-320'], ['Administração', 'Intelbras', 'CIE 1125'],
      ['Fábrica Montadora', 'Siemens', 'FC723'], ['Torre Empresarial', 'Bosch', 'FPA-5000'],
      ['Centro Educacional', 'Intelbras', 'CIE 1125'], ['Hotel Central', 'NOTIFIER', 'NFS2-320'],
      ['Condomínio Parque', 'Segurimax', 'SFT-2000'], ['Data Center Norte', 'Siemens', 'FC723'],
    ];
    const images = [
      'https://images.pexels.com/photos/31836902/pexels-photo-31836902.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/38841831/pexels-photo-38841831.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/6473188/pexels-photo-6473188.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      'https://images.pexels.com/photos/2083391/pexels-photo-2083391.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ];
    return names.map(([buildingName, manufacturer, model], index) => {
      const status: PanelStatus = index === 1 ? 'alarm' : index === 4 ? 'fault' : 'online';
      const now = new Date(Date.now() - (index + 1) * 7 * 60000).toISOString();
      const panel = {
        id: `sim-panel-${index}`, tenant_id: profile?.tenant_id ?? 'sim-tenant', building_id: `sim-building-${index}`,
        manufacturer, model, asset_code: `SIM-${String(index + 1).padStart(3, '0')}`, install_location: 'Sala técnica',
        zone_count: [12, 8, 16, 10, 6, 8, 12, 14, 20][index % 9], has_api: index % 3 === 0,
        has_ethernet: true, has_relay_output: true, interface_type: 'relay', auxiliary_output_type: 'dry_contact',
        installed_at: null, installer: 'FireGuard Engenharia', notes: 'Dados demonstrativos', status: 'active',
      } as Panel;
      const building = {
        id: `sim-building-${index}`, tenant_id: profile?.tenant_id ?? 'sim-tenant', name: buildingName,
        internal_code: `SIM-${index + 1}`, address: 'Av. Demonstrativa, 100', city: 'São Paulo', state: 'SP',
        technical_contact: 'Equipe técnica', operational_contact: 'Operação', panel_count: 1, notes: null, status: 'active', created_at: now,
      } as Building;
      const gateway = {
        id: `sim-gateway-${index}`, tenant_id: profile?.tenant_id ?? 'sim-tenant', building_id: building.id, panel_id: panel.id,
        name: `Gateway ${String(index + 1).padStart(2, '0')}`, device_code: `SIM-GW-${index + 1}`, manufacturer: 'FireGuard', model: 'FG-100',
        unique_identifier: `SIM-${index + 1}`, connectivity_type: 'ethernet', firmware_version: '2.1.3', config_version: 'demo',
        input_count: panel.zone_count, status: status === 'fault' ? 'degraded' : 'online', last_heartbeat_at: now, last_event_at: now,
        heartbeat_interval_sec: 30, offline_threshold_sec: 90, downtime_started_at: null, provisioned: true,
      } as Gateway;
      const event = {
        id: `sim-event-${index}`, tenant_id: gateway.tenant_id, gateway_id: gateway.id, building_id: building.id, panel_id: panel.id,
        input_id: null, external_event_id: `sim-${index}`, sequence: index + 100, event_type: status === 'alarm' ? 'alarm' : status === 'fault' ? 'comm_loss' : 'heartbeat',
        state: status === 'alarm' ? 'active' : status === 'fault' ? 'fault' : 'normal', input_ref: status === 'alarm' ? 'Zona 3 - Fumaça' : 'heartbeat',
        occurred_at: now, received_at: now, acknowledged: false, acknowledged_by: null, acknowledged_at: null,
        severity: status === 'alarm' ? 'critical' : status === 'fault' ? 'warning' : 'info',
        descricao: status === 'alarm' ? 'Alarme de incêndio - Incêndio' : status === 'fault' ? 'Perda de comunicação - Sem comunicação' : 'Heartbeat - Status da central',
        // Codigo Contact ID para aplicar a regra de cores (verde estatico no online).
        qualificador: status === 'alarm' ? '1' : status === 'fault' ? '1' : '1',
        codigo_contato: status === 'alarm' ? '130' : status === 'fault' ? '301' : '602',
        zona: '003',
      } as unknown as EventRow;
      const tone: ContactIdTone = status === 'alarm' ? 'critical' : status === 'fault' ? 'warning' : 'ok';
      return {
        panel, building, gateway, status, tone,
        activeEvents: status === 'alarm' || status === 'fault' ? [event] : [],
        lastEvent: event, statusEvent: event,
        activeAlarmCount: status === 'alarm' ? 1 : 0, faultCount: status === 'fault' ? 1 : 0,
        recentEvents: [event], imageUrl: images[index % images.length],
      };
    });
  }

  // Realtime: aplica o evento atual direto no board, sem reload.
  // Ordena por received_at desc para garantir que lastEvent seja sempre o ultimo.
  // useRef para nao recriar a inscricao a cada render (evita perder eventos / duplicar listener).
  const applyRealtimeEvent = useCallback((newEvent: EventRow) => {
    setBoards((prev) => {
      // Descobre a central: por panel_id, ou por conta (Contact ID) / IP se o
      // evento veio sem vinculo. A conta tem precedencia sobre o IP.
      let idx = prev.findIndex((b) => newEvent.panel_id != null && newEvent.panel_id === b.panel.id);
      if (idx < 0 && (newEvent.panel_id == null || newEvent.panel_id === '')) {
        if (newEvent.conta != null && newEvent.conta !== '') {
          idx = prev.findIndex((b) => String(newEvent.conta) === String(b.panel.asset_code ?? ''));
        }
        if (idx < 0) {
          idx = prev.findIndex((b) =>
            newEvent.origem_ip != null && newEvent.origem_ip !== '' && String(b.panel.ip_data ?? '').includes(String(newEvent.origem_ip))
          );
        }
      }
      if (idx < 0) {
        // Central nova ou filtro mudou: recarrega uma vez para incluir
        void loadRef.current();
        return prev;
      }
      const next = [...prev];
      const b = next[idx];
      const recent = [newEvent, ...b.recentEvents.filter((e) => e.id !== newEvent.id)]
        .sort((x, y) => String(y.received_at ?? '').localeCompare(String(x.received_at ?? '')))
        .slice(0, 8);
      const lastEvent = recent[0] ?? null;
      // Reconcilia todos os eventos conhecidos da central (inclui o novo),
      // para que uma restauracao (qualificador 3) limpe o alarme e a central
      // volte ao verde sem pulsar.
      const merged = new Map<string, EventRow>();
      for (const e of [...b.recentEvents, ...b.activeEvents, newEvent]) {
        const key = e.id ?? `${e.received_at}_${e.event_type}`;
        merged.set(key, e);
      }
      const state = reconcilePanelState([...merged.values()] as unknown as PanelEvent[]);
      const activeAlarmCount = state.activeAlarmCount;
      const faultCount = state.faultCount;
      let status: PanelStatus = b.status;
      if (state.hasActiveAlarm) status = 'alarm';
      else if (state.hasActiveFault) status = 'fault';
      else if (b.gateway) {
        if (b.gateway.status === 'online') status = 'online';
        else if (b.gateway.status === 'offline') status = 'offline';
        else if (b.gateway.status === 'degraded') status = 'fault';
      } else if (state.hasOnline) {
        status = 'online';
      }
      next[idx] = {
        ...b, lastEvent, tone: state.tone,
        statusEvent: (state.statusEvent as unknown as EventRow) ?? lastEvent,
        activeEvents: state.activeEvents as unknown as EventRow[],
        recentEvents: recent, activeAlarmCount, faultCount, status,
      };
      return next;
    });
    setLastUpdate(new Date());
  }, []);

  // Realtime subscription for new events (1 inscricao por montagem, sem loop)
  useEffect(() => {
    if (!profile) return;
    let alive = true;
    const channel = db
      .channel('monitor-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos' }, (payload) => {
        if (!alive) return;
        const newEvent = payload.new as EventRow;
        // Evento atual: aceita tenant null/vazio (sem empresa) + tenant do usuario.
        if (!isPlatformAdminRef.current && profileRef.current?.tenant_id && newEvent.tenant_id != null && newEvent.tenant_id !== '' && newEvent.tenant_id !== profileRef.current.tenant_id) return;
        applyRealtimeEvent(newEvent);
        // Fallback: garante sincronia mesmo se algum docChange for perdido
        void loadRef.current();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'eventos' }, (payload) => {
        if (!alive) return;
        applyRealtimeEvent(payload.new as EventRow);
        void loadRef.current();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gateways' }, () => {
        if (alive) void loadRef.current();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'buildings' }, () => {
        if (alive) void loadRef.current();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'buildings' }, () => {
        if (alive) void loadRef.current();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'panels' }, () => {
        if (alive) void loadRef.current();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'panels' }, () => {
        if (alive) void loadRef.current();
      })
      .subscribe();
    return () => { alive = false; db.removeChannel(channel); };
  }, [profile, applyRealtimeEvent]);

  // Polling anti-freeze: a cada 10s re-sincroniza o estado. Nao substitui o realtime;
  // apenas garante que a tela nunca fique presa se algum docChange for perdido.
  useEffect(() => {
    if (isDemo) return;
    const id = window.setInterval(() => { void pollLatest(); }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  const buildings = Array.from(new Set(boards.map((b) => b.building).filter(Boolean))) as Building[];

  // Live clock for the panel header
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const filtered = boards
    .filter((b) => {
      if (filterStatus && b.status !== filterStatus) return false;
      if (filterBuilding && b.building?.id !== filterBuilding) return false;
      const q = search.trim().toLowerCase();
      if (q) {
        const terms = q.split(/\s+/).filter(Boolean);
        const words = [b.building?.name, b.panel.manufacturer, b.panel.model, b.panel.asset_code, b.panel.install_location, b.panel.installer, b.panel.notes, b.gateway?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .split(/\s+/);
        // Cada termo digitado deve ser prefixo ou substring de alguma palavra nos campos
        const allMatch = terms.every((term) => words.some((w) => w.includes(term) || w.startsWith(term)));
        if (!allMatch) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const priority: Record<PanelStatus, number> = {
        alarm: 0,
        fault: 1,
        offline: 2,
        unknown: 3,
        online: 4,
      };
      return priority[a.status] - priority[b.status];
    });

  // Summary counts
  const summary = {
    alarm: boards.filter((b) => b.status === 'alarm').length,
    fault: boards.filter((b) => b.status === 'fault').length,
    online: boards.filter((b) => b.status === 'online').length,
    offline: boards.filter((b) => b.status === 'offline').length,
    unknown: boards.filter((b) => b.status === 'unknown').length,
    total: boards.length,
  };

  const statusConfig: Record<PanelStatus, { label: string; color: string; bg: string; border: string; icon: typeof Flame; glow?: boolean }> = {
    alarm: { label: 'ALARME ATIVO', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', icon: Flame, glow: true },
    fault: { label: 'FALHA', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', icon: AlertTriangle },
    online: { label: 'OPERACIONAL', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', icon: ShieldCheck },
    offline: { label: 'SEM COMUNICAÇÃO', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: WifiOff },
    unknown: { label: 'ESTADO DESCONHECIDO', color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', icon: AlertTriangle },
  };

  // Dark-theme status styles for the control panel cards.
  // A cor vem do tom definido pela regra de cores do Contact ID:
  //   critical (vermelho) -> pulsa | warning (ambar) -> pulsa suave | ok (verde) -> estatico
  const toneCard: Record<ContactIdTone, { badge: string; thumb: string; dot: string; border: string; text: string }> = {
    critical: { badge: 'bg-red-500/15 text-red-400 border-red-500/40', thumb: 'border-red-500/40', dot: 'bg-red-500', border: 'border-red-500/60', text: 'text-red-400' },
    warning: { badge: 'bg-amber-500/15 text-amber-400 border-amber-500/40', thumb: 'border-amber-500/40', dot: 'bg-amber-500', border: 'border-amber-500/50', text: 'text-amber-400' },
    ok: { badge: 'bg-green-500/15 text-green-400 border-green-500/40', thumb: 'border-green-500/40', dot: 'bg-green-500', border: 'border-green-500/40', text: 'text-green-400' },
    info: { badge: 'bg-blue-500/15 text-blue-400 border-blue-500/40', thumb: 'border-blue-500/40', dot: 'bg-blue-500', border: 'border-blue-500/40', text: 'text-blue-400' },
  };
  const neutralCard = { badge: 'bg-slate-500/15 text-slate-300 border-slate-500/40', thumb: 'border-slate-500/40', dot: 'bg-slate-400', border: 'border-white/10', text: 'text-slate-300' };

  /** Estilo do card conforme o tom do evento (regra de cores Contact ID). */
  function cardStyle(board: PanelBoard) {
    // Evento ativo cuja regra Contact ID defina pulse=true (alarme/falha
    // reconciliado) força a cor do card: alarme ou falha ativa nunca aparece
    // verde/azul, mesmo com o gateway online.
    const pulsingEvent =
      board.activeEvents.find((e) => resolveEventTone(e).pulse) ??
      ((board.statusEvent
        && (board.statusEvent.state ?? '') !== 'normal'
        && resolveEventTone(board.statusEvent).pulse)
        ? board.statusEvent
        : null);
    const pulsingTone = pulsingEvent ? resolveEventTone(pulsingEvent).tone : null;

    // Tom de cor do card (borda/badge): o status derivado dos eventos manda;
    // um evento pulsante tambem força a cor para que alarme/falha ativa
    // nunca apareca verde/azul.
    let tone: ContactIdTone = board.tone;
    const evTone = board.statusEvent ? resolveEventTone(board.statusEvent).tone : null;
    if (evTone && (tone === 'info' || tone === 'ok')) tone = evTone;
    if (board.status === 'alarm') tone = 'critical';        // alarme ativo => vermelho, pulsa
    else if (board.status === 'fault') tone = 'warning';    // falha ativa => amarelo, pulsa suave
    else if (board.status === 'offline') tone = 'critical'; // perda de comunicacao
    else if (board.status === 'unknown') tone = 'info';     // sem informacao
    else if (board.status === 'online' && tone === 'info') tone = 'ok'; // central reportando
    if (pulsingTone === 'critical') tone = 'critical';
    else if (pulsingTone === 'warning' && tone !== 'critical') tone = 'warning';

    const base = board.status === 'unknown' && !pulsingEvent ? neutralCard : toneCard[tone];
    // Regra unica: TODO card exibido em VERMELHO (critical) ou AMBAR (warning)
    // pisca; verde (ok), azul (info) e cinza (desconhecido) nunca piscam.
    // Como o tone ja reflete alarme/falha ativos, gateway degradado/offline e
    // restauracao (qualificador 3 -> ok), o piscar comeca e para junto da cor.
    const pulse =
      tone === 'critical' ? 'card-blink-critical'
      : tone === 'warning' ? 'card-blink-attention'
      : '';
    if (pulse) {
      console.debug(
        '[monitor:pulse]',
        board.building?.name ?? board.panel.asset_code ?? board.panel.id,
        '=>', tone, pulse,
        'evento=', pulsingEvent ? (pulsingEvent.codigo_contato ?? pulsingEvent.event_type ?? 's/codigo') : `status=${board.status}`,
      );
    }
    return { ...base, pulse, tone };
  }

  const alarmBoards = filtered.filter((b) => b.status === 'alarm');

  const recentActivity = boards
    .flatMap((b) => b.recentEvents.map((evt) => ({ evt, buildingName: b.building?.name ?? b.panel.manufacturer })))
    .sort((a, b) => new Date(b.evt.received_at).getTime() - new Date(a.evt.received_at).getTime())
    .slice(0, 10);

  // Sound signalling for cards needing attention:
  // active alarms → triple high-pitched beep; faults/comm loss → double lower beep. Repeats every 5s.
  useEffect(() => {
    if (!soundEnabled) return;
    if (summary.alarm + summary.fault + summary.offline === 0) return;

    const AudioCtx = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    alarmAudioRef.current = ctx;

    const beep = (frequency: number, count: number) => {
      if (ctx.state === 'suspended') void ctx.resume();
      for (let i = 0; i < count; i++) {
        const start = ctx.currentTime + i * 0.3;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.25);
      }
    };

    const signal = () => {
      if (summary.alarm > 0) beep(950, 3);   // critical: triple beep
      else beep(550, 2);                     // attention: double beep
    };

    signal();
    const interval = window.setInterval(signal, 5000);
    return () => {
      window.clearInterval(interval);
      alarmAudioRef.current = null;
      void ctx.close();
    };
  }, [soundEnabled, summary.alarm, summary.fault, summary.offline]);

  return (
    <>
      {/* Full-bleed dark control panel */}
      <div className="-mx-4 lg:-mx-6 -my-6 min-h-[calc(100vh-4rem)] bg-[#0B1220] flex flex-col">
        {/* Panel top bar */}
        <div className="flex flex-col gap-3 px-5 py-4 border-b border-white/10 bg-[#0E1526] sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-white">Painel de Controle</h1>
              {simulationMode && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  Demonstração
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {simulationMode
                ? 'Demonstração visual — centrais simuladas em tempo real'
                : 'Monitoramento em tempo real de todos os centros de controle'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-medium tabular-nums">
              <Clock className="w-4 h-4 text-slate-500" />
              {now.toLocaleDateString('pt-BR')} · {now.toLocaleTimeString('pt-BR')}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-green-400 bg-green-500/10 border border-green-500/30 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Ao vivo
            </div>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              aria-pressed={soundEnabled}
              title={soundEnabled ? 'Desativar sinalização sonora' : 'Ativar sinalização sonora'}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                soundEnabled
                  ? 'bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              {soundEnabled ? 'Som de alarme: ON' : 'Som de alarme: OFF'}
            </button>
            {!isDemo && simulationMode && (
              <button
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                onClick={load}
                disabled={loading}
              >
                <X className="w-3.5 h-3.5" /> Sair da demonstração
              </button>
            )}
            <button
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-50"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </div>
        </div>

        {/* Summary chips */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-5 py-4 shrink-0">
          <div className={`rounded-xl border p-3.5 bg-[#121A2C] ${summary.alarm > 0 ? 'border-red-500/60 blink-critical' : 'border-white/10'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Flame className="w-4 h-4 text-red-500" />
              <span className="text-xs text-slate-400">Alarmes Ativos</span>
            </div>
            <div className="text-2xl font-bold text-red-500">{summary.alarm}</div>
          </div>
          <div className={`rounded-xl border p-3.5 bg-[#121A2C] ${summary.fault > 0 ? 'border-amber-500/50 blink-attention' : 'border-white/10'}`}>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-slate-400">Centrais com Falha</span>
            </div>
            <div className="text-2xl font-bold text-amber-500">{summary.fault}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#121A2C] p-3.5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-green-500" />
              <span className="text-xs text-slate-400">Operacionais</span>
            </div>
            <div className="text-2xl font-bold text-green-500">{summary.online}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#121A2C] p-3.5">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-slate-400">Última Comunicação</span>
            </div>
            <div className="text-2xl font-bold text-blue-400 tabular-nums">{lastUpdate.toLocaleTimeString('pt-BR')}</div>
          </div>
        </div>

        {/* Body: centers grid + right rail */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-4 px-5 py-4">
          {/* Centers */}
          <div className="lg:col-span-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-semibold text-white tracking-wide">
                Centros de Incêndia <span className="text-slate-500 font-normal">({filtered.length})</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nome, código..."
                    className="w-44 sm:w-52 pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="" className="bg-[#0E1526]">Todos os status</option>
                  <option value="alarm" className="bg-[#0E1526]">Alarme ativo</option>
                  <option value="fault" className="bg-[#0E1526]">Falha</option>
                  <option value="online" className="bg-[#0E1526]">Operacional</option>
                  <option value="offline" className="bg-[#0E1526]">Sem comunicação</option>
                  <option value="unknown" className="bg-[#0E1526]">Desconhecido</option>
                </select>
                <select
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filterBuilding}
                  onChange={(e) => setFilterBuilding(e.target.value)}
                >
                  <option value="" className="bg-[#0E1526]">Todos os edifícios</option>
                  {buildings.map((b) => <option key={b.id} value={b.id} className="bg-[#0E1526]">{b.name}</option>)}
                </select>
                {(filterStatus || filterBuilding || search) && (
                  <button
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                    onClick={() => { setFilterStatus(''); setFilterBuilding(''); setSearch(''); }}
                  >
                    <X className="w-3.5 h-3.5" /> Limpar
                  </button>
                )}
              </div>
            </div>

            {/* Board grid */}
            {loading ? (
              <div className="text-center py-16 text-slate-500">
                <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-slate-600" />
                Carregando centrais...
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#121A2C] p-16 text-center">
                <CircuitBoard className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">Nenhuma central encontrada com os filtros selecionados.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {filtered.map((board) => {
                  const cfg = cardStyle(board);
                  const StatusIcon = statusConfig[board.status].icon;
                  // Rotulo do badge: descricao do evento que motiva o status
                  // (alarme ativo > falha ativa > ultimo evento); senao o rotulo padrao.
                  const statusLabel = (eventLabelFor(board.statusEvent ?? {}, cfg.tone === 'ok' ? 'OPERACIONAL' : statusConfig[board.status].label)
                    || eventBadgeLabel(board.statusEvent?.descricao)) ?? '';
                  // Foto exibida no card: avatar enviado no cadastro do edificio;
                  // as simulacoes mantem as imagens de demonstracao (imageUrl).
                  const thumbSrc = board.imageUrl ?? board.building?.avatar_url ?? null;
                  return (
                    <div
                      key={board.panel.id}
                      className={`rounded-xl border bg-[#121A2C] p-3 cursor-pointer ${cfg.pulse ? 'transition-none' : 'transition-all duration-200 hover:bg-[#182138]'} ${cfg.border} ${cfg.pulse}`}
                      onClick={() => setDetail(board)}
                    >
                      {/* Header */}
                      <div className="flex items-start gap-3">
                        <div className={`relative w-11 h-11 rounded-lg overflow-hidden flex items-center justify-center shrink-0 border bg-[#0E1526] ${cfg.thumb}`}>
                          {thumbSrc ? (
                            <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Building2 className="w-5 h-5 text-slate-500" />
                          )}
                          <span className={`absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-[#0E1526] ${cfg.dot}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white truncate">{board.building?.name ?? 'Sem edifício'}</div>
                          <div className="text-[11px] text-slate-500 truncate">{board.panel.manufacturer} · {board.panel.model}</div>
                        </div>
                      </div>

                      {/* Status badge: usa a descricao do ultimo evento quando disponivel */}
                      <div className={`mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[10px] font-bold tracking-wide ${cfg.badge}`}>
                        <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate" title={statusLabel}>{statusLabel}</span>
                      </div>

                      {/* Location + gateway */}
                      <div className="mt-2 space-y-1 text-[11px]">
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <MapPin className="w-3 h-3 shrink-0 text-slate-500" />
                          <span className="truncate">{[board.building?.address, board.building?.city, board.building?.state].filter(Boolean).join(', ') || '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <Radio className="w-3 h-3 shrink-0 text-slate-500" />
                          <span className="truncate">{board.gateway?.name ?? 'Sem gateway'}</span>
                          {board.gateway && (
                            <span className={`ml-auto shrink-0 ${board.gateway.status === 'online' ? 'text-green-400' : board.gateway.status === 'offline' ? 'text-red-400' : 'text-amber-400'}`}>
                              {board.gateway.status === 'online' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Event indicators */}
                      <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-white/5 text-[11px]">
                        <div className="flex items-center gap-1">
                          <Flame className={`w-3.5 h-3.5 ${board.activeAlarmCount > 0 ? 'text-red-500' : 'text-slate-600'}`} />
                          <span className={board.activeAlarmCount > 0 ? 'text-red-400 font-bold' : 'text-slate-500'}>{board.activeAlarmCount}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <AlertTriangle className={`w-3.5 h-3.5 ${board.faultCount > 0 ? 'text-amber-500' : 'text-slate-600'}`} />
                          <span className={board.faultCount > 0 ? 'text-amber-400 font-bold' : 'text-slate-500'}>{board.faultCount}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-500">
                          <CircuitBoard className="w-3.5 h-3.5" />
                          <span>{board.panel.zone_count} zonas</span>
                        </div>
                        <div className="ml-auto flex items-center gap-1 text-slate-500">
                          <Clock className="w-3 h-3" />
                          <span>{board.lastEvent ? timeAgo(board.lastEvent.received_at) : '24h sem eventos'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right rail */}
          <div className="min-w-0 flex flex-col gap-4">
            {/* Active alarms */}
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide mb-3">
                Alarmes Ativos <span className="text-slate-500 font-normal">({alarmBoards.length})</span>
              </h2>
              {alarmBoards.length === 0 ? (
                <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-green-400 shrink-0" />
                  <p className="text-xs text-green-400">Nenhum alarme ativo no momento.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alarmBoards.map((board) => {
                    const ev = board.statusEvent;
                    const tone = resolveEventTone(ev ?? {}).tone;
                    const label = eventLabelFor(ev ?? {}, 'ALARME DE INCÊNDIO').toUpperCase();
                    const alarmLabel = eventLabelFor(ev ?? {}, 'ALARME DE INCÊNDIO');
                    return (
                    <div key={board.panel.id} className={`rounded-xl border p-3 ${tone === 'warning' ? 'border-amber-500/60 bg-amber-500/10 blink-attention' : 'border-red-500/60 bg-red-500/10 blink-critical'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`w-2 h-2 rounded-full ${tone === 'warning' ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <span className={`text-[11px] font-bold tracking-wider ${tone === 'warning' ? 'text-amber-400' : 'text-red-400'}`}>{label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {board.building?.avatar_url && (
                          <img src={board.building.avatar_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0 border border-white/10" />
                        )}
                        <div className="text-sm font-semibold text-white truncate min-w-0">{board.building?.name ?? 'Sem edifício'}</div>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-400">
                        <div className="truncate">Central: {board.panel.manufacturer} {board.panel.model}</div>
                        <div>Zona: {board.statusEvent?.input_ref || '—'}</div>
                        {board.statusEvent && (
                          <div className="truncate" title={alarmLabel}>{alarmLabel}</div>
                        )}
                        <div className="text-slate-500">{board.statusEvent ? formatDateTime(board.statusEvent.received_at) : '—'}</div>
                      </div>
                      <button
                        onClick={() => setDetail(board)}
                        className="mt-2.5 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition-colors"
                      >
                        Ver detalhes <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent activity */}
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-white tracking-wide mb-3">Últimas Atividades</h2>
              <div className="rounded-xl border border-white/10 bg-[#121A2C] divide-y divide-white/5 overflow-hidden">
                {recentActivity.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-slate-500">Nenhum evento nas últimas 24 horas.</p>
                ) : (
                  recentActivity.map(({ evt, buildingName }) => (
                    <div key={evt.id} className="flex items-center gap-2.5 px-3 py-2.5">
                      <span className="text-[10px] text-slate-500 tabular-nums shrink-0">{formatTime(evt.received_at)}</span>
                      <span className={`badge text-[10px] shrink-0 ${eventBadgeDark(evt)}`}>
                        {eventLabelFor(evt, EVENT_LABELS[evt.event_type as keyof typeof EVENT_LABELS] ?? evt.event_type)}
                      </span>
                      <span className="text-xs text-slate-400 truncate">{buildingName}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="px-5 pb-3 text-[10px] leading-relaxed text-slate-500">
          O painel mostra o estado conhecido com base nos dados recebidos — uma central online indica que a plataforma está recebendo dados, não a ausência de incêndio.
          Estados desconhecidos, falhas e perda de comunicação são diferenciados. Plataforma complementar de monitoramento.
        </div>

        {/* Status bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-[#0E1526] shrink-0">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <span><b className="text-white">{summary.total}</b> Centrais monitoradas</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <b className="text-green-400">{summary.online}</b> Operacional
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <b className="text-amber-400">{summary.fault}</b> Em falha
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <b className="text-red-400">{summary.offline}</b> Sem comunicação
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>Última atualização: {formatDateTime(lastUpdate.toISOString())}</span>
            <span className="flex items-center gap-1.5 text-green-400">
              <Wifi className="w-3.5 h-3.5" /> Plataforma conectada
            </span>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalhes da Central" size="lg">
        {detail && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${statusConfig[detail.status].bg} border ${statusConfig[detail.status].border}`}>
                <CircuitBoard className={`w-6 h-6 ${statusConfig[detail.status].color}`} />
              </div>
              <div>
                <div className="font-bold text-slate-900 text-lg">{detail.panel.manufacturer} {detail.panel.model}</div>
                <div className={`badge ${statusConfig[detail.status].bg} ${statusConfig[detail.status].color} border ${statusConfig[detail.status].border} mt-1`}>
                  {statusConfig[detail.status].label}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-slate-400">Edifício</div><div className="text-slate-700">{detail.building?.name ?? '—'}</div></div>
              <div><div className="text-xs text-slate-400">Local</div><div className="text-slate-700">{detail.panel.install_location ?? '—'}</div></div>
              <div><div className="text-xs text-slate-400">Zonas</div><div className="text-slate-700">{detail.panel.zone_count}</div></div>
              <div><div className="text-xs text-slate-400">Gateway</div><div className="text-slate-700">{detail.gateway?.name ?? 'Sem gateway'}</div></div>
              <div><div className="text-xs text-slate-400">Código patrimonial</div><div className="text-slate-700">{detail.panel.asset_code ?? '—'}</div></div>
              <div><div className="text-xs text-slate-400">Status do gateway</div><div className="text-slate-700 capitalize">{detail.gateway?.status ?? '—'}</div></div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-sm">
                <Cpu className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">API: {detail.panel.has_api ? 'Sim' : 'Não'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <Wifi className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Ethernet: {detail.panel.has_ethernet ? 'Sim' : 'Não'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <ToggleRight className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">Relé: {detail.panel.has_relay_output ? 'Sim' : 'Não'}</span>
              </div>
            </div>

            {/* Event indicators */}
            <div className="grid grid-cols-3 gap-3">
              <div className={`rounded-lg p-3 text-center ${detail.activeAlarmCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-slate-50 border border-slate-100'}`}>
                <Flame className={`w-5 h-5 mx-auto mb-1 ${detail.activeAlarmCount > 0 ? 'text-red-600' : 'text-slate-300'}`} />
                <div className={`text-2xl font-bold ${detail.activeAlarmCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>{detail.activeAlarmCount}</div>
                <div className="text-xs text-slate-500">Alarmes ativos</div>
              </div>
              <div className={`rounded-lg p-3 text-center ${detail.faultCount > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50 border border-slate-100'}`}>
                <AlertTriangle className={`w-5 h-5 mx-auto mb-1 ${detail.faultCount > 0 ? 'text-amber-600' : 'text-slate-300'}`} />
                <div className={`text-2xl font-bold ${detail.faultCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{detail.faultCount}</div>
                <div className="text-xs text-slate-500">Falhas (24h)</div>
              </div>
              <div className="rounded-lg p-3 text-center bg-slate-50 border border-slate-100">
                <Activity className="w-5 h-5 mx-auto mb-1 text-slate-400" />
                <div className="text-2xl font-bold text-slate-600">{detail.recentEvents.length}</div>
                <div className="text-xs text-slate-500">Eventos (24h)</div>
              </div>
            </div>

            {/* Recent events timeline */}
            <div>
              <h4 className="font-semibold text-slate-900 text-sm mb-3">Eventos recentes</h4>
              {detail.recentEvents.length === 0 ? (
                <p className="text-sm text-slate-400">Nenhum evento nas últimas 24 horas.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {detail.recentEvents.map((evt) => (
                    <div key={evt.id} className="flex items-center gap-3 text-sm py-2 px-3 rounded-lg bg-slate-50">
                      <span className={`badge ${eventTypeColor(evt)} text-xs`}>
                        {eventLabelFor(evt, EVENT_LABELS[evt.event_type as keyof typeof EVENT_LABELS] ?? evt.event_type)}
                      </span>
                      <span className="text-slate-500 text-xs flex-1">{evt.input_ref || '—'}</span>
                      <span className="text-xs text-slate-400">{formatDateTime(evt.received_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
