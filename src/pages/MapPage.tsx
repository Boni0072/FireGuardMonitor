import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Tooltip, useMap, Circle } from 'react-leaflet';
import { useAuth } from '@/context/AuthContext';
import { db, Panel, Gateway, Building, EventRow, isDemoAccount, fetchAllEvents } from '@/lib/db';
import { Modal } from '@/components/Modal';
import {
  MapPin, RefreshCw, Flame, AlertTriangle, WifiOff, ShieldCheck,
  HelpCircle, Building2, CircuitBoard, Search, X, Maximize2, Minimize2,
} from 'lucide-react';
import { EVENT_LABELS, eventTypeColor, eventLabelFor, eventBadgeLabel, formatDateTime, timeAgo } from '@/lib/eventHelpers';
import { reconcilePanelState, type PanelEvent } from '@/lib/eventReconcile';
import 'leaflet/dist/leaflet.css';

function MapCenter({ coords }: { coords: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (coords) {
      map.setView(coords, 15);
    }
  }, [coords, map]);
  return null;
}

type BuildingStatus = 'alarm' | 'fault' | 'offline' | 'online' | 'unknown';

interface PanelStatusEntry {
  panel: Panel;
  status: BuildingStatus;
  eventName: string | null;
}

interface BuildingBoard {
  building: Building;
  panels: PanelStatusEntry[];
  gateways: Gateway[];
  status: BuildingStatus;
  alarmEvents: EventRow[];
  recentEvents: EventRow[];
  lastEvent: EventRow | null;
  lat: number;
  lng: number;
}

const STATUS_META: Record<BuildingStatus, { label: string; color: string; badge: string; blink: string; markerPulse: string; icon: typeof Flame }> = {
  alarm: { label: 'Alerta ativo', color: '#ef4444', badge: 'bg-red-100 text-red-700 border border-red-200', blink: 'blink-critical', markerPulse: 'marker-pulse-critical', icon: Flame },
  fault: { label: 'Em falha', color: '#f59e0b', badge: 'bg-amber-100 text-amber-700 border border-amber-200', blink: 'blink-attention', markerPulse: 'marker-pulse-attention', icon: AlertTriangle },
  offline: { label: 'Sem comunicação', color: '#ef4444', badge: 'bg-red-100 text-red-700 border border-red-200', blink: 'blink-critical', markerPulse: 'marker-pulse-critical', icon: WifiOff },
  online: { label: 'Operacional', color: '#22c55e', badge: 'bg-green-100 text-green-700 border border-green-200', blink: '', markerPulse: '', icon: ShieldCheck },
  unknown: { label: 'Desconhecido', color: '#3b82f6', badge: 'bg-blue-100 text-blue-700 border border-blue-200', blink: '', markerPulse: '', icon: HelpCircle },
};

const STATUS_PRIORITY: Record<BuildingStatus, number> = { alarm: 0, fault: 1, offline: 2, unknown: 3, online: 4 };

const STATUS_ORDER: BuildingStatus[] = ['alarm', 'fault', 'offline', 'online', 'unknown'];

// Ordem de empilhamento: marcadores pulsantes ficam acima dos verdes/azuis
// quando ha sobreposicao de posicoes.
const STATUS_Z_INDEX: Record<BuildingStatus, number> = { alarm: 1000, offline: 800, fault: 600, online: 0, unknown: 0 };

// Fallback city centroids (Brazil) for buildings without latitude/longitude
const CITY_CENTERS: Record<string, [number, number]> = {
  'sao paulo': [-23.5505, -46.6333],
  'rio de janeiro': [-22.9068, -43.1729],
  'brasilia': [-15.7939, -47.8828],
  'salvador': [-12.9777, -38.5016],
  'fortaleza': [-3.7319, -38.5267],
  'belo horizonte': [-19.9167, -43.9345],
  'manaus': [-3.119, -60.0217],
  'curitiba': [-25.4284, -49.2733],
  'recife': [-8.0476, -34.877],
  'porto alegre': [-30.0346, -51.2177],
  'belem': [-1.4558, -48.4902],
  'goiania': [-16.6869, -49.2648],
  'sao luis': [-2.5307, -44.3068],
  'maceio': [-9.6498, -35.7089],
  'campinas': [-22.9099, -47.0626],
  'santos': [-23.9608, -46.3336],
  'natal': [-5.7945, -35.211],
  'teresina': [-5.0892, -42.8019],
  'joao pessoa': [-7.1195, -34.845],
  'aracaju': [-10.9472, -37.0731],
  'vitoria': [-20.3154, -40.3128],
  'cuiaba': [-15.6014, -56.0979],
  'florianopolis': [-27.5954, -48.548],
};

function normalizeCity(city: string | null): string {
  return (city ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Some records were saved with the decimal separator stripped (e.g. -46486573
// instead of -46.486573). Detect out-of-range values and shift the decimal
// back into place; returns null when the value is unusable so callers can
// fall back to the city centroid.
function normalizeCoord(value: unknown, maxAbs: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) <= maxAbs) return n;
  if (Math.abs(n) < 1000) return null; // small out-of-range typo: prefer the city fallback
  let v = n;
  for (let i = 0; i < 10 && Math.abs(v) > maxAbs; i++) v /= 10;
  return Math.abs(v) <= maxAbs ? v : null;
}

function resolveCoords(building: Building): [number, number] {
  const fixedLat = normalizeCoord(building.latitude, 90);
  const fixedLng = normalizeCoord(building.longitude, 180);
  if (fixedLat != null && fixedLng != null) {
    return [fixedLat, fixedLng];
  }
  const center = CITY_CENTERS[normalizeCity(building.city)] ?? CITY_CENTERS['sao paulo'];
  const h = hashString(building.id);
  const dLat = ((h % 100) / 100 - 0.5) * 0.24;
  const dLng = (((h >> 7) % 100) / 100 - 0.5) * 0.24;
  return [center[0] + dLat, center[1] + dLng];
}

async function geocodeAddress(address: string): Promise<[number, number] | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { 'Accept-Language': 'pt-BR' } },
    );
    const data = await response.json();
    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      return [lat, lng];
    }
    return null;
  } catch {
    return null;
  }
}

// Cache de DivIcon POR EDIFICIO: a MESMA referencia entre recargas do mapa
// (15s / realtime) enquanto status e avatar nao mudam, para o react-leaflet
// nao chamar setIcon e a animacao de pulsacao nao reiniciar a cada load().
// Mudou status (pulso comeca/para) ou foto nova, cria um icon novo.
interface CachedMarkerIcon {
  status: BuildingStatus;
  avatar: string | null;
  icon: L.DivIcon;
}

const markerIconCache = new Map<string, CachedMarkerIcon>();

function makeIcon(board: BuildingBoard): L.DivIcon {
  const avatar = board.building.avatar_url ?? null;
  const cached = markerIconCache.get(board.building.id);
  if (cached && cached.status === board.status && cached.avatar === avatar) return cached.icon;
  const meta = STATUS_META[board.status];
  // Foto do edificio (base64) dentro do marcador; sem foto, mantem o ponto colorido.
  const avatarHtml = avatar ? `<img class="marker-avatar" src="${avatar}" alt="" />` : '';
  const icon = L.divIcon({
    className: 'map-marker-wrap',
    html: `<div class="map-marker${avatar ? ' map-marker-has-avatar' : ''} ${meta.markerPulse}" style="background:${meta.color};--marker-color:${meta.color}">${avatarHtml}</div>`,
    iconSize: avatar ? [28, 28] : [20, 20],
    iconAnchor: avatar ? [14, 14] : [10, 10],
  });
  markerIconCache.set(board.building.id, { status: board.status, avatar, icon });
  return icon;
}

function derivePanelStatus(panel: Panel, gateway: Gateway | undefined, events: EventRow[]): BuildingStatus {
  // MESMA reconciliacao do MonitorPage (fonte unica de verdade): restauracao
  // (qualificador 3) cancela o disparo; "Online" (602) como evento mais recente
  // encerra alarmes/falhas anteriores. Assim o mapa nunca mostra um status
  // diferente do Painel de Controle para a mesma central.
  const state = reconcilePanelState(events as unknown as PanelEvent[]);
  if (state.hasActiveAlarm) return 'alarm';
  if (state.hasActiveFault) return 'fault';
  if (gateway) {
    if (gateway.status === 'online') return 'online';
    if (gateway.status === 'offline') return 'offline';
    if (gateway.status === 'degraded') return 'fault';
    return 'unknown';
  }
  // Sem gateway cadastrado: operacional apenas se a central reportou "Online" (602).
  return state.hasOnline ? 'online' : 'unknown';
}

/** Nome do evento que motiva o status da central — usa a MESMA reconciliacao
 *  do MonitorPage (alarme ativo > falha ativa), com restauracao e reconexao. */
function derivePanelEventName(events: EventRow[]): string | null {
  const state = reconcilePanelState(events as unknown as PanelEvent[]);
  if (!state.hasActiveAlarm && !state.hasActiveFault) return null;
  return state.statusEvent ? eventBadgeLabel(state.statusEvent.descricao) : null;
}

// Demonstration data: 20 buildings spread across Brazilian cities so the map
// shows markers in every status (alarm, fault, offline, online) when the
// tenant has fewer than 10 real panels — same rule as MonitorPage.
const SIM_PANEL_SPECS: [string, string][] = [
  ['Intelbras', 'CIE 1125'],
  ['NOTIFIER', 'NFS2-320'],
  ['Bosch', 'FPA-5000'],
  ['Siemens', 'FC723'],
  ['Segurimax', 'SFT-2000'],
];

function createSimulationBoards(): BuildingBoard[] {
  const defs: { name: string; address: string; city: string; state: string; status: BuildingStatus }[] = [
    { name: 'Ed. Comercial Alpha', address: 'Av. Paulista 1000', city: 'São Paulo', state: 'SP', status: 'online' },
    { name: 'Hospital São Lucas', address: 'Rua das Flores 250', city: 'São Paulo', state: 'SP', status: 'alarm' },
    { name: 'Shopping Center Iguatemi', address: 'Av. João Pessoa 1500', city: 'São Paulo', state: 'SP', status: 'online' },
    { name: 'Ed. Residencial Jardim', address: 'Rua das Acácias 80', city: 'Campinas', state: 'SP', status: 'online' },
    { name: 'Indústria Têxtil Norte', address: 'Av. das Indústrias 400', city: 'Santos', state: 'SP', status: 'fault' },
    { name: 'Escola Municipal Cenecista', address: 'Rua Goiás 310', city: 'Rio de Janeiro', state: 'RJ', status: 'online' },
    { name: 'Ed. Corporativo Beta', address: 'Av. Atlântica 500', city: 'Rio de Janeiro', state: 'RJ', status: 'online' },
    { name: 'Hospital Villa Nova', address: 'Av. Pastor M. L. King 1200', city: 'Rio de Janeiro', state: 'RJ', status: 'alarm' },
    { name: 'Centro Logístico Sudeste', address: 'Rod. Anhanguera km 85', city: 'Campinas', state: 'SP', status: 'online' },
    { name: 'Shopping Plaza', address: 'Av. Iguatemi 700', city: 'Curitiba', state: 'PR', status: 'offline' },
    { name: 'Unidade Operacional Sul', address: 'Rua XV de Novembro 900', city: 'Curitiba', state: 'PR', status: 'online' },
    { name: 'Ed. Financeiro Ipê', address: 'Av. Sete de Setembro 300', city: 'Brasília', state: 'DF', status: 'online' },
    { name: 'Clínica Médica Centro', address: 'SGAN 601 Bloco B', city: 'Brasília', state: 'DF', status: 'fault' },
    { name: 'Administração Regional', address: 'Av. Umuarama 1050', city: 'Curitiba', state: 'PR', status: 'online' },
    { name: 'Fábrica Montadora', address: 'Av. das Nações 2200', city: 'Belo Horizonte', state: 'MG', status: 'online' },
    { name: 'Torre Empresarial Savassi', address: 'Rua Pernambuco 1100', city: 'Belo Horizonte', state: 'MG', status: 'online' },
    { name: 'Centro Educacional Sul', address: 'Av. Ipiranga 500', city: 'Porto Alegre', state: 'RS', status: 'online' },
    { name: 'Hotel Central', address: 'Av. Beira-Mar 100', city: 'Fortaleza', state: 'CE', status: 'online' },
    { name: 'Condomínio Parque', address: 'Av. República do Líbano 500', city: 'Salvador', state: 'BA', status: 'offline' },
    { name: 'Data Center Norte', address: 'Av. Torquato Tapajós 4000', city: 'Manaus', state: 'AM', status: 'online' },
  ];

  return defs.map((def, index) => {
    const [manufacturer, model] = SIM_PANEL_SPECS[index % SIM_PANEL_SPECS.length];
    const ts = new Date(Date.now() - (index + 1) * 9 * 60000).toISOString();

    const building: Building = {
      id: `sim-bld-${index}`, tenant_id: 'sim-tenant', name: def.name,
      internal_code: `SIM-${String(index + 1).padStart(3, '0')}`,
      address: def.address, city: def.city, state: def.state,
      technical_contact: 'Equipe técnica', operational_contact: 'Operação',
      panel_count: 1, notes: 'Dados demonstrativos', status: 'active',
      latitude: null, longitude: null, created_at: ts,
    };

    const panel = {
      id: `sim-panel-${index}`, tenant_id: 'sim-tenant', building_id: building.id,
      manufacturer, model, asset_code: `SIM-P${index + 1}`, install_location: 'Sala técnica',
      zone_count: 8 + (index % 5) * 4, has_api: index % 3 === 0, has_ethernet: true,
      has_relay_output: true, interface_type: 'relay', auxiliary_output_type: 'dry_contact',
      installed_at: null, installer: 'FireGuard Engenharia', notes: 'Dados demonstrativos', status: 'active',
    } as Panel;

    const gwStatus = def.status === 'offline' ? 'offline' : def.status === 'fault' ? 'degraded' : 'online';
    const gateway = {
      id: `sim-gw-${index}`, tenant_id: 'sim-tenant', building_id: building.id,
      panel_id: panel.id, name: `GW-${String(index + 1).padStart(2, '0')}`,
      device_code: `SIM-GW-${index + 1}`, manufacturer: 'FireGuard', model: 'FG-100',
      unique_identifier: `SIMGW-${index + 1}`, connectivity_type: 'ethernet',
      firmware_version: '2.1.3', config_version: 'demo', input_count: panel.zone_count,
      status: gwStatus, last_heartbeat_at: ts, last_event_at: ts,
      heartbeat_interval_sec: 30, offline_threshold_sec: 90, downtime_started_at: null,
      provisioned: true,
    } as Gateway;

    const eventType = def.status === 'online' ? 'heartbeat' : def.status === 'alarm' ? 'alarm' : 'comm_loss';
    const event = {
      id: `sim-evt-${index}`, tenant_id: 'sim-tenant', gateway_id: gateway.id,
      building_id: building.id, panel_id: panel.id, input_id: null,
      external_event_id: `sim-${index}`, sequence: index + 100,
      event_type: eventType,
      state: def.status === 'alarm' ? 'active' : def.status === 'online' ? 'normal' : 'fault',
      input_ref: def.status === 'alarm' ? 'Zona 3 - Fumaça' : eventType === 'heartbeat' ? 'heartbeat' : 'Zona 1 - Comunicação',
      occurred_at: ts, received_at: ts, acknowledged: false, acknowledged_by: null,
      acknowledged_at: null,
      severity: def.status === 'alarm' ? 'critical' : def.status === 'online' ? 'info' : 'warning',
    } as EventRow;

    const [lat, lng] = resolveCoords(building);

    return {
      building,
      panels: [{ panel, status: def.status, eventName: null }],
      gateways: [gateway],
      status: def.status,
      alarmEvents: def.status === 'alarm' ? [event] : [],
      recentEvents: [event],
      lastEvent: event,
      lat,
      lng,
    };
  });
}


function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  // Content-based key: refit only when coordinates actually change (filter/data),
  // not on every reload that merely creates a new array with the same values.
  const pointsKey = points.map(([la, lo]) => `${la},${lo}`).join(';');
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    const pts = pointsRef.current.filter(
      ([la, lo]) => Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180,
    );
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
  }, [map, pointsKey]);

  return null;
}

function FullscreenSync({ fullscreen }: { fullscreen: boolean }) {
  const map = useMap();
  useEffect(() => {
    // The map container changes size when entering/leaving fullscreen;
    // Leaflet needs to re-measure to render tiles/controls correctly.
    const t = window.setTimeout(() => map.invalidateSize(), 120);
    return () => window.clearTimeout(t);
  }, [map, fullscreen]);
  return null;
}

export function MapPage() {
  const { profile } = useAuth();
  const isPlatformAdmin = profile?.role === 'platform_admin';
  const isDemo = isDemoAccount(profile?.email);

  const [boards, setBoards] = useState<BuildingBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BuildingBoard | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [simulationMode, setSimulationMode] = useState(false);
  const [searchAddress, setSearchAddress] = useState('');
  const [searchCoords, setSearchCoords] = useState<[number, number] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BuildingStatus | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Refs do auto-refresh: loadRef sempre aponta para a versao mais recente de
  // load; silentReloadRef marca recarga automatica (nao pisca "Atualizando...").
  const loadRef = useRef(load);
  const silentReloadRef = useRef(false);

  // Esc exits fullscreen (doesn't touch native Fullscreen API).
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  async function load() {
    // Demo account: always render the simulated portfolio (the account has no
    // real buildings of its own).
    if (isDemo) {
      setBoards(createSimulationBoards());
      setSimulationMode(true);
      setLastUpdate(new Date());
      setLoading(false);
      return;
    }
    // Reload automatico (intervalo) nao deve piscar o indicador "Atualizando...".
    if (!silentReloadRef.current) setLoading(true);

    const [bldRes, panelRes, gwRes] = await Promise.all([
      db.from('buildings').select('*').order('name'),
      db.from('panels').select('*'),
      db.from('gateways').select('*'),
    ]);

    // Carrega todos os registros sem filtro de servidor: buildings, panéis e gateways
    // legados podem nao ter tenant_id preenchido (null). Filtramos no cliente incluindo
    // null/vazio, mesma regra aplicada aos eventos, para nao excluir esses prédios e
    // seus painéis/gateways do mapa.
    let allBuildings = (bldRes.data ?? []) as Building[];
    let allPanels = (panelRes.data ?? []) as Panel[];
    let allGateways = (gwRes.data ?? []) as Gateway[];
    if (!isPlatformAdmin && profile?.tenant_id) {
      const tid = profile.tenant_id;
      allBuildings = allBuildings.filter((b) => {
        const t = b.tenant_id as string | null;
        return t == null || t === '' || t === tid;
      });
      allPanels = allPanels.filter((p) => {
        const t = p.tenant_id as string | null;
        return t == null || t === '' || t === tid;
      });
      allGateways = allGateways.filter((g) => {
        const t = g.tenant_id as string | null;
        return t == null || t === '' || t === tid;
      });
    }
    const buildings = allBuildings;
    const panels = allPanels;
    const gateways = allGateways;

    // Mesma fonte de verdade do MonitorPage: fetchAllEvents() normaliza
    // documentos legados (codigo/conta/qualificador -> event_type/state/severity),
    // deduplica por Contact ID e nao usa .match() no servidor (eventos legados
    // podem ter tenant_id null). SEM janela de 24h e ordenado por received_at
    // desc — o status do mapa precisa derivar do MESMO conjunto do painel
    // (um alarme sem restauracao segue ativo la apos 24h; aqui tambem).
    let allEvents = ((await fetchAllEvents(500)) as EventRow[])
      .sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')));
    if (!isPlatformAdmin && profile?.tenant_id) {
      allEvents = allEvents.filter((e) => {
        const t = e.tenant_id as string | null;
        return t == null || t === '' || t === profile.tenant_id;
      });
    }

    const built: BuildingBoard[] = buildings.map((building) => {
      const bPanels = panels.filter((p) => p.building_id === building.id);
      const bGateways = gateways.filter((g) => g.building_id === building.id);
      // Associa eventos a paineis: por panel_id quando disponível; caso contrário
      // por conta (Contact ID) == asset_code ou por origem_ip == ip_data, mesma
      // regra usada em MonitorPage e PanelsPage, pois eventos legados da colecao
      // `eventos` nao possuem panel_id preenchido.
      const bEvents = allEvents.filter((e) =>
        bPanels.some((p) => {
          if (e.panel_id != null && e.panel_id !== '') return e.panel_id === p.id;
          if (e.building_id != null && e.building_id !== '') return e.building_id === building.id;
          if (e.conta != null && e.conta !== '') return String(e.conta) === String(p.asset_code ?? '');
          return e.origem_ip != null && e.origem_ip !== '' && String(p.ip_data ?? '').includes(String(e.origem_ip));
        })
      );

      const panelStatuses: PanelStatusEntry[] = bPanels.map((panel) => {
        const gateway = gateways.find((g) => g.panel_id === panel.id);
        const events = bEvents.filter((e) =>
          e.panel_id === panel.id ||
          (e.panel_id == null &&
            ((e.conta != null && String(e.conta) === String(panel.asset_code ?? '')) ||
              (e.origem_ip != null && String(panel.ip_data ?? '').includes(String(e.origem_ip))))),
        );
        return {
          panel,
          status: derivePanelStatus(panel, gateway, events),
          eventName: derivePanelEventName(events),
        };
      });

      // Building status = worst status among its panels (or its gateways when it has no panels)
      let status: BuildingStatus = 'unknown';
      if (panelStatuses.length > 0) {
        status = panelStatuses.reduce<BuildingStatus>(
          (worst, entry) => (STATUS_PRIORITY[entry.status] < STATUS_PRIORITY[worst] ? entry.status : worst),
          'online',
        );
      } else if (bGateways.length > 0) {
        if (bGateways.every((g) => g.status === 'online')) status = 'online';
        else if (bGateways.some((g) => g.status === 'degraded')) status = 'fault';
        else if (bGateways.some((g) => g.status === 'offline')) status = 'offline';
      }

      // Alarmes ativos da edificacao: mesma reconciliacao do painel (restauracao
      // q3 e reconexao 602 respeitadas); o contador do popup considera apenas
      // os nao confirmados.
      const bState = reconcilePanelState(bEvents as unknown as PanelEvent[]);
      const alarmEvents = bState.activeEvents
        .filter((e) => String(e.event_type ?? '') === 'alarm' && !e.acknowledged)
        .map((e) => e as unknown as EventRow);
      const [lat, lng] = resolveCoords(building);

      return {
        building,
        panels: panelStatuses,
        gateways: bGateways,
        status,
        alarmEvents,
        recentEvents: bEvents.slice(0, 12),
        lastEvent: bEvents[0] ?? null,
        lat,
        lng,
      };
    });

    setSimulationMode(false);
    setBoards(built);
    setLastUpdate(new Date());
    setLoading(false);
    // Debug detalhado para verificar associacao de eventos e status de cada building.
    console.debug('[map:debug] totalEventsLoaded=', allEvents.length, 'totalBuildings=', buildings.length, 'totalPanels=', panels.length);
    built.forEach((b) => {
      const meta = STATUS_META[b.status];
      const panelInfos = b.panels.map((p) => ({
        panelId: p.panel.id,
        assetCode: p.panel.asset_code,
        ipData: p.panel.ip_data,
        status: p.status,
        eventName: p.eventName,
      }));
      const relevantEvents = allEvents.filter((e) =>
        b.panels.some((p) =>
          e.panel_id === p.panel.id ||
          (e.building_id != null && e.building_id === b.building.id) ||
          (e.conta != null && String(e.conta) === String(p.panel.asset_code ?? '')) ||
          (e.origem_ip != null && String(p.panel.ip_data ?? '').includes(String(e.origem_ip)))
        )
      );
      console.debug('[map:marker]', b.building.name, '=>', b.status, meta.color, meta.blink || '(sem pulso)', '| panels:', panelInfos, '| matchedEvents:', relevantEvents.length, relevantEvents.map((e) => ({ codigo: e.codigo_contato, qualificador: e.qualificador, event_type: e.event_type, state: e.state, conta: e.conta, origem_ip: e.origem_ip })));
    });
  }

  async function handleSearchAddress() {
    if (!searchAddress.trim()) return;
    setSearchLoading(true);
    const coords = await geocodeAddress(searchAddress);
    setSearchLoading(false);
    if (coords) {
      setSearchCoords(coords);
    }
  }

  useEffect(() => { load(); }, [profile, isPlatformAdmin]);

  // Auto-refresh em silencio (mesma filosofia do polling do MonitorPage): o
  // mapa acompanha o painel sem exigir clique em "Atualizar" e sem piscar o
  // indicador de carregamento.
  loadRef.current = load;
  useEffect(() => {
    if (isDemo) return;
    const id = window.setInterval(() => {
      if (silentReloadRef.current) return; // reload anterior ainda em andamento
      silentReloadRef.current = true;
      void loadRef.current()
        .catch(() => undefined)
        .finally(() => { silentReloadRef.current = false; });
    }, 15_000);
    return () => window.clearInterval(id);
  }, [isDemo]);

  // Realtime refresh when events change
  useEffect(() => {
    if (!profile) return;
    const channel = db
      .channel('map-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos' }, () => { load(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'eventos' }, () => { load(); })
      .subscribe();
    return () => { db.removeChannel(channel); };
  }, [profile]);

  // Markers/points respect the status filter; counts always show the totals.
  const visibleBoards = useMemo(
    () => (statusFilter ? boards.filter((b) => b.status === statusFilter) : boards),
    [boards, statusFilter],
  );
  const points = useMemo(() => visibleBoards.map((b) => [b.lat, b.lng] as [number, number]), [visibleBoards]);
  const markers = useMemo(() => visibleBoards.map((b) => ({ board: b, icon: makeIcon(b) })), [visibleBoards]);
  const counts = useMemo(() => {
    const c: Record<BuildingStatus, number> = { alarm: 0, fault: 0, offline: 0, online: 0, unknown: 0 };
    boards.forEach((b) => { c[b.status] += 1; });
    return c;
  }, [boards]);

  const alertBoards = boards.filter((b) => b.status === 'alarm');

  return (
    <>
      <div className="-mx-4 lg:-mx-6 -my-6 min-h-[calc(100vh-4rem)] bg-[#0B1220] flex flex-col">
        {/* Top bar */}
        <div className="flex flex-col gap-3 px-5 py-4 border-b border-white/10 bg-[#0E1526] xl:flex-row xl:items-center xl:justify-between shrink-0">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white flex items-center gap-2 flex-wrap">
              <MapPin className="w-5 h-5 text-blue-400" /> Mapa de Edifícios
              {simulationMode && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-semibold text-amber-400 tracking-wide">
                  DEMONSTRAÇÃO
                </span>
              )}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Localização dos edifícios com status em tempo real — clique em um marcador para ver os detalhes
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_ORDER.map((key) => {
              const meta = STATUS_META[key];
              const active = statusFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(active ? null : key)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                    active
                      ? `${meta.badge} ring-2 ring-white/40`
                      : counts[key] > 0
                        ? `${meta.badge} opacity-60 hover:opacity-100`
                        : 'bg-white/5 border-white/10 text-slate-400 opacity-60 hover:opacity-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: counts[key] > 0 ? meta.color : '#475569' }} />
                  {meta.label} ({counts[key]})
                </button>
              );
            })}
            {statusFilter && (
              <button
                type="button"
                onClick={() => setStatusFilter(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-[11px] font-medium text-slate-300 hover:bg-white/10 transition-colors"
              >
                <X className="w-3 h-3" /> Limpar filtro
              </button>
            )}
            <button
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-50"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </div>
        </div>

        {/* Busca por endereço */}
        <div className="px-5 py-3 border-b border-white/10 bg-[#0E1526]">
          <div className="relative flex max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              className="input pl-10 pr-10 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Buscar por endereço ou cidade (ex: São Vicente, SP)..."
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchAddress()}
            />
            {searchLoading && (
              <button className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" disabled>
                <svg className="w-full h-full animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              </button>
            )}
            {!searchLoading && searchAddress && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-slate-400 hover:text-white"
                onClick={() => { setSearchAddress(''); setSearchCoords(null); }}
              >
                Limpar
              </button>
            )}
            {!searchLoading && !searchAddress && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-blue-400 hover:text-blue-300"
                onClick={handleSearchAddress}
              >
                Buscar
              </button>
            )}
          </div>
          {searchCoords && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-400">
              <MapPin className="w-3 h-3" />
              <span>Endereço encontrado: {searchCoords[0].toFixed(4)}, {searchCoords[1].toFixed(4)}</span>
            </div>
          )}
        </div>

        {/* Map */}
        <div className={fullscreen ? 'fixed inset-0 z-[1000] bg-[#0B1220]' : 'flex-1 relative min-h-[420px]'}>
          <MapContainer className="absolute inset-0 z-0" center={[-15.7939, -47.8828]} zoom={4} minZoom={3} maxZoom={18}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              subdomains="abc"
              maxZoom={19}
            />
            <FitBounds points={points} />
            <MapCenter coords={searchCoords} />
            <FullscreenSync fullscreen={fullscreen} />
            {markers.map(({ board, icon }) => (
              <Marker
                key={board.building.id}
                position={[board.lat, board.lng]}
                icon={icon}
                zIndexOffset={STATUS_Z_INDEX[board.status]}
                eventHandlers={{ click: () => setSelected(board) }}
              >
                <Tooltip direction="top" offset={[0, -12]} className="map-tooltip">
                  <span>{board.building.name} — {STATUS_META[board.status].label}</span>
                </Tooltip>
              </Marker>
            ))}
            {searchCoords && (
              <>
                <Marker
                  position={searchCoords}
                  icon={L.divIcon({
                    className: 'search-marker',
                    html: `<div style="width:20px;height:20px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);position:relative;"></div><div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid #22c55e;"></div>`,
                    iconSize: [20, 26],
                    iconAnchor: [10, 26],
                  })}
                >
                  <Tooltip direction="top" offset={[0, -10]} className="map-tooltip">
                    <span>Endereço buscado: {searchAddress}</span>
                  </Tooltip>
                </Marker>
                <Circle
                  center={searchCoords}
                  radius={200}
                  color="#22c55e"
                  fillColor="#22c55e"
                  fillOpacity={0.2}
                  weight={2}
                />
              </>
            )}
          </MapContainer>

          {/* Loading indicator */}
          {loading && (
            <div className="absolute top-3 right-3 z-[500] flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0E1526]/90 border border-white/10 text-xs text-slate-300">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Atualizando...
            </div>
          )}

          {/* Blinking alert shortcut */}
          {alertBoards.length > 0 && (
            <button
              onClick={() => setSelected(alertBoards[0])}
              className="absolute top-3 left-3 z-[500] max-w-xs text-left rounded-xl border-2 border-red-500/60 bg-red-500/15 backdrop-blur px-3 py-2 blink-critical"
            >
              <div className="flex items-center gap-2 text-[11px] font-bold text-red-300 tracking-wider">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {alertBoards.length} ALERTA(S) ATIVO(S)
              </div>
              <div className="text-xs text-red-200 mt-0.5 truncate">
                {alertBoards.map((b) => b.building.name).join(', ')}
              </div>
            </button>
          )}

          {/* Empty state */}
          {boards.length === 0 && !loading && (
            <div className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none">
              <div className="rounded-xl border border-white/10 bg-[#121A2C]/95 px-6 py-5 text-center">
                <Building2 className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-300">Nenhum edifício cadastrado para exibir no mapa.</p>
              </div>
            </div>
          )}

          {/* Filter with no matches */}
          {statusFilter && boards.length > 0 && visibleBoards.length === 0 && !loading && (
            <div className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none">
              <div className="rounded-xl border border-white/10 bg-[#121A2C]/95 px-6 py-5 text-center">
                <HelpCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-300">Nenhum edifício com o status "{STATUS_META[statusFilter].label}".</p>
                <button
                  type="button"
                  onClick={() => setStatusFilter(null)}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline pointer-events-auto"
                >
                  Limpar filtro
                </button>
              </div>
            </div>
          )}

          {/* Fullscreen toggle */}
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? 'Sair da tela inteira' : 'Expandir mapa em tela inteira'}
            aria-label={fullscreen ? 'Sair da tela inteira' : 'Expandir mapa em tela inteira'}
            aria-pressed={fullscreen}
            className="absolute bottom-4 right-4 z-[600] p-2.5 rounded-lg bg-[#0E1526]/90 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 backdrop-blur transition-colors shadow-lg"
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>

        {/* Status bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-white/10 bg-[#0E1526] shrink-0">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <span>
              <b className="text-white">{visibleBoards.length}</b> Edifícios no mapa
              {statusFilter && <span className="text-slate-500"> (de {boards.length})</span>}
            </span>
            <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /><b className="text-green-400">{counts.online}</b> Operacional</span>
            <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /><b className="text-red-400">{counts.alarm}</b> Em alerta</span>
            <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /><b className="text-amber-400">{counts.fault}</b> Em falha</span>
            <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" /><b className="text-orange-400">{counts.offline}</b> Sem comunicação</span>
          </div>
          <span className="text-xs text-slate-400">Última atualização: {formatDateTime(lastUpdate.toISOString())}</span>
        </div>
      </div>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.status === 'alarm' ? 'Detalhamento do Alerta' : 'Detalhes do Edifício'}
        size="lg"
        zClass={fullscreen ? 'z-[1100]' : 'z-50'}
      >
        {selected && (
          <div className="space-y-5">
            {selected.status === 'alarm' ? (
              /* Alert detail — blinking red box */
              <div className="rounded-xl border-2 border-red-500/70 bg-red-50 p-4 blink-critical">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                  <span className="text-xs font-bold text-red-700 tracking-wider">ALARME DE INCÊNDIO</span>
                </div>
                <div className="text-lg font-bold text-slate-900">{selected.building.name}</div>
                <div className="text-sm text-slate-500">
                  {[selected.building.address, selected.building.city, selected.building.state].filter(Boolean).join(', ') || '—'}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
                  <div>
                    <div className="text-xs text-slate-400">Central</div>
                    <div className="text-slate-700 font-medium">
                      {selected.panels[0]?.panel.manufacturer ?? '—'} {selected.panels[0]?.panel.model ?? ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Zona</div>
                    <div className="text-slate-700 font-medium">{(selected.alarmEvents[0] ?? selected.lastEvent)?.input_ref || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Ocorrência</div>
                    <div className="text-slate-700 font-medium">
                      {formatDateTime((selected.alarmEvents[0] ?? selected.lastEvent)?.received_at ?? null)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Gateway</div>
                    <div className="text-slate-700 font-medium">
                      {selected.gateways[0]?.name ?? 'Sem gateway'} ({selected.gateways[0]?.status ?? '—'})
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-red-700 font-medium">
                  <Flame className="w-4 h-4" />
                  {selected.alarmEvents.length} alarme(s) ativo(s) não confirmado(s) · último evento {timeAgo(selected.lastEvent?.received_at ?? null)}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: STATUS_META[selected.status].color }} />
                <div className="min-w-0">
                  <div className="text-lg font-bold text-slate-900 truncate">{selected.building.name}</div>
                  <span className={`badge text-[10px] ${STATUS_META[selected.status].badge}`}>
                    {STATUS_META[selected.status].label}
                  </span>
                </div>
              </div>
            )}

            {/* Building info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-slate-400">Endereço</div>
                <div className="text-slate-700">
                  {[selected.building.address, selected.building.city, selected.building.state].filter(Boolean).join(', ') || '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Código</div>
                <div className="text-slate-700">{selected.building.internal_code ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Centrais</div>
                <div className="text-slate-700">{selected.panels.length}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Gateways</div>
                <div className="text-slate-700">{selected.gateways.length}</div>
              </div>
            </div>

            {/* Panels */}
            {selected.panels.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-900 text-sm mb-2">Centrais</h4>
                <div className="space-y-2">
                  {selected.panels.map(({ panel, status, eventName }) => {
                    // Piscar conforme o status da central (mesma regra do MonitorPage):
                    // alarme / sem comunicacao => vermelho (blink-critical); falha => ambar (blink-attention).
                    const blink = status === 'alarm' || status === 'offline'
                      ? 'blink-critical'
                      : status === 'fault'
                        ? 'blink-attention'
                        : '';
                    const rowTone = status === 'alarm' || status === 'offline'
                      ? 'border-red-500/60 bg-red-50'
                      : status === 'fault'
                        ? 'border-amber-500/60 bg-amber-50'
                        : 'bg-slate-50 border-slate-100';
                    return (
                      <div key={panel.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm ${rowTone} ${blink}`}>
                        <CircuitBoard className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="text-slate-700 font-medium flex-1 truncate">{panel.manufacturer} {panel.model}</span>
                        <span className="text-xs text-slate-400 shrink-0">{panel.asset_code ?? '—'}</span>
                        <span className={`badge text-[10px] shrink-0 ${STATUS_META[status].badge}`}>{eventName ?? STATUS_META[status].label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent events */}
            <div>
              <h4 className="font-semibold text-slate-900 text-sm mb-2">Eventos recentes (24h)</h4>
              {selected.recentEvents.length === 0 ? (
                <p className="text-sm text-slate-400">Nenhum evento registrado nas últimas 24 horas.</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {selected.recentEvents.map((evt) => (
                    <div key={evt.id} className="flex items-center gap-3 text-sm py-1.5 px-3 rounded-lg bg-slate-50">
                      <span className={`badge text-[10px] shrink-0 ${eventTypeColor(evt)}`}>
                        {eventLabelFor(evt, EVENT_LABELS[evt.event_type as keyof typeof EVENT_LABELS] ?? evt.event_type)}
                      </span>
                      <span className="text-slate-500 text-xs flex-1 truncate">{evt.input_ref || '—'}</span>
                      <span className="text-xs text-slate-400 shrink-0">{formatDateTime(evt.received_at)}</span>
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


