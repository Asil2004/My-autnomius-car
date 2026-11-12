/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * QALQON PARKI: ko'p robot va ko'p operator aloqasi.
 *
 *   Robot planshet (ID: QALQON-01, QALQON-02, ...) ──WebRTC video + "data" kanali──▶ uni tanlagan operatorlar
 *                                                  ──MQTT (1 Hz, shifrlangan)──────▶ barcha operatorlar (ro'yxat, xarita)
 *
 * Hammasi bitta PARK KODI bilan shifrlanadi (AES-GCM). Operatorlarga ID berish shart emas: ular vaqtinchalik ID oladi.
 * MQTT mavzulari (F = park mavzusi, T = F/r/<ROBOT-ID>):
 *   T/status        robot holati (retained): shifrlangan {online, id, inst} yoki ochiq "offline" (uzilsa LWT)
 *   T/tel           telemetriya (retained, ~1 Hz): joylashuv, tezlik, yo'nalish, batareya, sonar, buyruq
 *   T/join          operator video so'rovi {id, name}
 *   T/v/<id>/offer  robot -> operator  |  T/v/<id>/answer  operator -> robot
 *   T/v/<id>/ice-r  robot ICE          |  T/v/<id>/ice     operator ICE
 */
import { camChannel, camLinkSettings, type CamChannel } from './camLinkSettings';
import { loadMqtt, MQTT_BROKER_URL } from './mqttLoader';
import { navigationService, type NavState } from './navigationService';
import { autopilotService, type AutopilotState, type AutopilotWaypoint } from './autopilotService';
import { startPtzRelay } from './ptzRelay';

/** Data kanal orqali uzatiladigan aniqlash ramkasi. Koordinatalar 0..1, kadrning o'zida (oynalanmagan) */
export interface WireBox {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  label: string;
  kind?: 'person' | 'car' | 'vehicle' | 'sign' | 'other';
  identified?: boolean;
  conf?: number;
  dist?: number;
  distApprox?: boolean;
  distUpper?: boolean;
}

/** Robot telemetriyasi: navigatsiya (bitta markaziy holatdan) va boshqa parametrlar */
export interface RobotTelemetry {
  id: string;
  t: number;
  nav?: {
    lat: number;
    lon: number;
    /** m/s */
    speed: number;
    heading: number;
    hsrc: NavState['headingSource'];
    psrc: NavState['positionSource'];
    acc: number;
    gpsAgeS: number;
  };
  battery?: { v?: number; pct?: number };
  sonars?: { front: number | null; rear: number | null; left: number | null; right: number | null };
  cmd?: string;
  viewers?: number;
  /** Robotda chalinayotgan sirena (A/B/C/D) yoki null */
  siren?: 'A' | 'B' | 'C' | 'D' | null;
  /** Robotga PTZ kamera moduli ulangan va tasviri uzatilmoqda */
  ptz?: boolean;
  /** GPS avtopilot holati (robot planshetida ishlaydi) */
  ap?: {
    on: boolean;
    ph: AutopilotState['phase'];
    msg: string;
    i: number;
    n: number;
    d: number;
    err: number;
    cmd: string;
  };
}

/** Operator -> robot: avtopilot buyrug'i (T/ap mavzusi, shifrlangan) */
export type AutopilotRemoteCmd =
  | { op: 'start'; route: AutopilotWaypoint[]; by: string; t: number }
  | { op: 'stop'; by: string; t: number };

/** Robot planshetida masofadan avtopilot yoqilganda (ilova HUD ga o'tishi uchun: kamera to'siq tahlili kerak) */
export const AUTOPILOT_REMOTE_EVENT = 'qalqon-autopilot-remote';

const MAX_VIEWERS = 6;
const VIDEO_MAX_BITRATE = 1_500_000;
const PTZ_MAX_BITRATE = 1_200_000;
const DC_SEND_MS = 100;
const TEL_MQTT_MS = 1000;

const rid = () => Math.random().toString(36).slice(2, 10);
const ID_RE = /^[A-Z0-9-]{1,24}$/;

async function connectMqtt(will?: { topic: string; payload: string }): Promise<any> {
  const mqtt = await loadMqtt();
  return mqtt.connect(MQTT_BROKER_URL, {
    clientId: `qalqon_${rid()}`,
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 20000,
    keepalive: 30,
    will: will ? { topic: will.topic, payload: will.payload, qos: 1, retain: true } : undefined
  });
}

const navToWire = (s: NavState): RobotTelemetry['nav'] | undefined =>
  s.initialized
    ? {
        lat: +s.lat.toFixed(7),
        lon: +s.lon.toFixed(7),
        speed: s.speed,
        heading: Math.round(s.heading * 10) / 10,
        hsrc: s.headingSource,
        psrc: s.positionSource,
        acc: s.accuracy,
        gpsAgeS: isFinite(s.gpsAgeMs) ? Math.round(s.gpsAgeMs / 100) / 10 : -1
      }
    : undefined;

// =============================================================================
// ROBOT TOMONI
// =============================================================================
interface ViewerPeer {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  /** Ikkinchi video: PTZ kamera moduli (PTZ / o'ng / chap linzalar bitta kadrda) */
  ptzSender: RTCRtpSender;
  dc: RTCDataChannel;
  pendingIce: RTCIceCandidateInit[];
  remoteSet: boolean;
  name: string;
}

export interface BroadcastStatus {
  state: 'off' | 'connecting' | 'online' | 'error';
  robotId: string;
  viewers: number;
  viewerNames: string[];
  error?: string;
  /** Shu ID bilan boshqa qurilma ham onlayn (ID takrorlangan) */
  duplicate?: boolean;
}

class RobotCamBroadcaster {
  private client: any = null;
  private channel: CamChannel | null = null;
  private T = '';
  private instance = rid();
  private peers = new Map<string, ViewerPeer>();
  private track: MediaStreamTrack | null = null;
  private ptzTrack: MediaStreamTrack | null = null;
  private stopPtzRelay: (() => void) | null = null;
  private boxes: WireBox[] = [];
  private extra: Omit<RobotTelemetry, 'id' | 't' | 'nav'> = {};
  private nav: NavState | null = null;
  private timers: number[] = [];
  private unsubNav: (() => void) | null = null;
  private status: BroadcastStatus = { state: 'off', robotId: '', viewers: 0, viewerNames: [] };
  private listeners = new Set<(s: BroadcastStatus) => void>();
  private generation = 0;

  getStatus() {
    return this.status;
  }

  subscribe(cb: (s: BroadcastStatus) => void) {
    this.listeners.add(cb);
    cb(this.status);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private setStatus(p: Partial<BroadcastStatus>) {
    const live = [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected');
    this.status = { ...this.status, ...p, viewers: live.length, viewerNames: live.map((v) => v.name) };
    this.listeners.forEach((l) => l(this.status));
  }

  /** Kamera oqimi (RobotFaceView yoki HUD ochgan). Ulangan operatorlarda ham darhol almashtiriladi */
  setSource(stream: MediaStream | null) {
    this.track = stream?.getVideoTracks()[0] ?? null;
    this.peers.forEach((p) => void p.sender.replaceTrack(this.track).catch(() => {}));
  }

  /** PTZ kamera moduli tasviri (ptzRelay). null: modul ulanmagan */
  private setPtzSource(track: MediaStreamTrack | null) {
    this.ptzTrack = track;
    this.peers.forEach((p) => void p.ptzSender.replaceTrack(track).catch(() => {}));
  }

  /** Faqat shu oqim hali manba bo'lsa olib tashlash */
  clearSource(stream: MediaStream | null) {
    if (stream && this.track && stream.getVideoTracks()[0] === this.track) this.setSource(null);
  }

  setBoxes(boxes: WireBox[]) {
    this.boxes = boxes;
  }

  /** Batareya, sonar, oxirgi buyruq (RobotContext dan) */
  setTelemetryExtra(extra: Omit<RobotTelemetry, 'id' | 't' | 'nav' | 'viewers'>) {
    this.extra = extra;
  }

  private telemetry(): RobotTelemetry {
    const a = autopilotService.getState();
    return {
      id: this.status.robotId,
      t: Date.now(),
      nav: this.nav ? navToWire(this.nav) : undefined,
      ...this.extra,
      viewers: this.status.viewers,
      ptz: !!this.ptzTrack,
      ap: {
        on: a.active,
        ph: a.phase,
        msg: a.message,
        i: a.targetIndex,
        n: a.total,
        d: Math.round(a.distanceToEndM),
        err: a.bearingErrorDeg,
        cmd: a.command
      }
    };
  }

  /** Operatordan kelgan avtopilot buyrug'i */
  private onAutopilotCmd(c: AutopilotRemoteCmd) {
    if (Math.abs(Date.now() - c.t) > 60_000) return; // eski (qayta yuborilgan) xabar
    if (c.op === 'stop') {
      autopilotService.stop(`Operator (${c.by}) to‘xtatdi`);
    } else if (Array.isArray(c.route) && c.route.length >= 1 && c.route.length <= 200) {
      const route = c.route.filter((p) => isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
      if (!route.length) return;
      window.dispatchEvent(new CustomEvent(AUTOPILOT_REMOTE_EVENT, { detail: { by: c.by } }));
      autopilotService.start(route.map((p) => ({ lat: p.lat, lon: p.lon })));
    }
    this.publishTelemetry();
  }

  async start() {
    if (this.client) return;
    const gen = ++this.generation;
    const s = camLinkSettings.get();
    this.setStatus({ state: 'connecting', robotId: s.robotId, error: undefined, duplicate: false });
    try {
      const channel = await camChannel(s.key);
      if (gen !== this.generation) return;
      this.channel = channel;
      const T = `${channel.topic}/r/${s.robotId}`;
      this.T = T;
      const client = await connectMqtt({ topic: `${T}/status`, payload: 'offline' });
      if (gen !== this.generation) {
        client.end(true);
        return;
      }
      this.client = client;
      client.on('connect', () => {
        client.subscribe([`${T}/join`, `${T}/v/+/answer`, `${T}/v/+/ice`, `${T}/status`, `${T}/ap`], { qos: 1 });
        void channel
          .seal({ online: true, id: s.robotId, inst: this.instance, t: Date.now() })
          .then((txt) => client.publish(`${T}/status`, txt, { qos: 1, retain: true }));
        this.setStatus({ state: 'online' });
      });
      client.on('offline', () => this.setStatus({ state: 'connecting' }));
      client.on('error', (e: Error) => this.setStatus({ state: 'connecting', error: e.message }));
      client.on('message', (topic: string, payload: Uint8Array) => void this.onMessage(topic, new TextDecoder().decode(payload)));
      this.unsubNav = navigationService.subscribe((n) => (this.nav = n));
      this.stopPtzRelay = startPtzRelay((t) => this.setPtzSource(t));
      this.timers.push(window.setInterval(() => this.sendDc(), DC_SEND_MS));
      this.timers.push(window.setInterval(() => this.publishTelemetry(), TEL_MQTT_MS));
    } catch (e) {
      this.setStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  stop() {
    this.generation++;
    this.timers.forEach((t) => window.clearInterval(t));
    this.timers = [];
    this.unsubNav?.();
    this.unsubNav = null;
    this.stopPtzRelay?.();
    this.stopPtzRelay = null;
    this.peers.forEach((p) => p.pc.close());
    this.peers.clear();
    if (this.client && this.T) {
      try {
        this.client.publish(`${this.T}/status`, 'offline', { qos: 1, retain: true });
      } catch {
        /* ulanish allaqachon yo'q */
      }
      this.client.end(false);
    }
    this.client = null;
    this.channel = null;
    this.T = '';
    this.setStatus({ state: 'off' });
  }

  private publish(topic: string, obj: unknown, retain = false) {
    const ch = this.channel;
    const client = this.client;
    if (!ch || !client?.connected) return;
    void ch.seal(obj).then((text) => client.publish(topic, text, { qos: retain ? 1 : 0, retain }));
  }

  private publishTelemetry() {
    if (this.T) this.publish(`${this.T}/tel`, this.telemetry(), true);
  }

  private async onMessage(topic: string, text: string) {
    const ch = this.channel;
    if (!ch) return;
    const T = this.T;
    if (topic === `${T}/status`) {
      // Shu ID bilan boshqa robot onlayn bo'lsa ogohlantiramiz (ID har bir robotda boshqacha bo'lishi kerak)
      if (text === 'offline') return;
      const st = await ch.open<{ inst: string; t: number }>(text);
      if (st && st.inst !== this.instance && Date.now() - st.t < 60_000) {
        this.setStatus({ duplicate: true, error: `${this.status.robotId} ID boshqa qurilmada ham ishlatilyapti` });
      }
      return;
    }
    if (topic === `${T}/ap`) {
      const c = await ch.open<AutopilotRemoteCmd>(text);
      if (c && (c.op === 'start' || c.op === 'stop')) this.onAutopilotCmd(c);
      return;
    }
    if (topic === `${T}/join`) {
      const msg = await ch.open<{ id: string; name?: string }>(text);
      if (msg?.id && /^[a-z0-9]{4,16}$/.test(msg.id)) await this.createPeer(msg.id, (msg.name || '').slice(0, 40));
      return;
    }
    const m = /\/v\/([a-z0-9]{4,16})\/(answer|ice)$/.exec(topic);
    if (!m) return;
    const peer = this.peers.get(m[1]);
    if (!peer) return;
    if (m[2] === 'answer') {
      const msg = await ch.open<{ sdp: string }>(text);
      if (!msg?.sdp || peer.remoteSet) return;
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(() => {});
      peer.remoteSet = true;
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else {
      const msg = await ch.open<{ c: RTCIceCandidateInit }>(text);
      if (!msg?.c) return;
      if (peer.remoteSet) await peer.pc.addIceCandidate(msg.c).catch(() => {});
      else peer.pendingIce.push(msg.c);
    }
  }

  private async createPeer(id: string, name: string) {
    const T = this.T;
    this.peers.get(id)?.pc.close();
    this.peers.delete(id);
    if (this.peers.size >= MAX_VIEWERS) {
      const stale = [...this.peers.entries()].find(([, p]) => p.pc.connectionState !== 'connected');
      if (!stale) return;
      stale[1].pc.close();
      this.peers.delete(stale[0]);
    }
    const pc = new RTCPeerConnection({ iceServers: camLinkSettings.iceServers() });
    const transceiver = pc.addTransceiver('video', { direction: 'sendonly' });
    if (this.track) await transceiver.sender.replaceTrack(this.track);
    // Ikkinchi video (har doim, modul ulanmagan bo'lsa bo'sh): PTZ ulanganda qayta kelishuvsiz darhol uzatiladi
    const ptzTransceiver = pc.addTransceiver('video', { direction: 'sendonly' });
    if (this.ptzTrack) await ptzTransceiver.sender.replaceTrack(this.ptzTrack);
    const dc = pc.createDataChannel('data', { ordered: false, maxRetransmits: 0 });
    const peer: ViewerPeer = { pc, sender: transceiver.sender, ptzSender: ptzTransceiver.sender, dc, pendingIce: [], remoteSet: false, name: name || 'Operator' };
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.publish(`${T}/v/${id}/ice-r`, { c: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.peers.get(id)?.pc === pc) this.peers.delete(id);
        pc.close();
      }
      this.setStatus({});
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    try {
      const params = transceiver.sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
      await transceiver.sender.setParameters(params);
      const pp = ptzTransceiver.sender.getParameters();
      pp.encodings = pp.encodings?.length ? pp.encodings : [{}];
      pp.encodings[0].maxBitrate = PTZ_MAX_BITRATE;
      await ptzTransceiver.sender.setParameters(pp);
    } catch {
      /* standart sifat */
    }
    this.publish(`${T}/v/${id}/offer`, { sdp: pc.localDescription?.sdp ?? offer.sdp });
  }

  /** Tanlagan operatorlarga 10 Hz: ramkalar + telemetriya (navigatsiya real vaqtda) */
  private sendDc() {
    if (!this.peers.size) return;
    const msg = JSON.stringify({ t: Date.now(), boxes: this.boxes, tel: this.telemetry() });
    this.peers.forEach((p) => {
      if (p.dc.readyState === 'open') {
        try {
          p.dc.send(msg);
        } catch {
          /* bitta xabar yo'qolsa muhim emas */
        }
      }
    });
  }
}

export const robotCamBroadcaster = new RobotCamBroadcaster();

// =============================================================================
// PARK KUZATUVCHISI (operator): barcha robotlar ro'yxati, holati va telemetriyasi
// =============================================================================
export interface FleetRobot {
  id: string;
  online: boolean;
  lastSeen: number;
  tel: RobotTelemetry | null;
}

export interface FleetState {
  connected: boolean;
  robots: FleetRobot[];
  error?: string;
}

const OFFLINE_AFTER_MS = 15_000;

class FleetWatcher {
  private client: any = null;
  private robots = new Map<string, FleetRobot>();
  private listeners = new Set<(s: FleetState) => void>();
  private state: FleetState = { connected: false, robots: [] };
  private sweep: number | null = null;
  private generation = 0;
  private channel: CamChannel | null = null;

  getState() {
    return this.state;
  }

  /** Operator: robotga avtopilot buyrug'i (marshrut bilan yurish yoki to'xtatish) */
  async sendAutopilot(robotId: string, cmd: { op: 'start'; route: AutopilotWaypoint[] } | { op: 'stop' }): Promise<boolean> {
    const ch = this.channel;
    const client = this.client;
    if (!ch || !client?.connected || !ID_RE.test(robotId)) return false;
    const by = camLinkSettings.get().operatorName || 'Operator';
    const text = await ch.seal({ ...cmd, by, t: Date.now() });
    client.publish(`${ch.topic}/r/${robotId}/ap`, text, { qos: 1 });
    return true;
  }

  subscribe(cb: (s: FleetState) => void) {
    this.listeners.add(cb);
    cb(this.state);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(p: Partial<FleetState> = {}) {
    const robots = [...this.robots.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.id.localeCompare(b.id));
    this.state = { ...this.state, ...p, robots };
    this.listeners.forEach((l) => l(this.state));
  }

  private upsert(id: string, patch: Partial<FleetRobot>) {
    const r = this.robots.get(id) ?? { id, online: false, lastSeen: 0, tel: null };
    this.robots.set(id, { ...r, ...patch });
  }

  async start() {
    if (this.client) return;
    const gen = ++this.generation;
    try {
      const channel = await camChannel(camLinkSettings.get().key);
      if (gen !== this.generation) return;
      const F = channel.topic;
      this.channel = channel;
      const client = await connectMqtt();
      if (gen !== this.generation) {
        client.end(true);
        return;
      }
      this.client = client;
      client.on('connect', () => {
        client.subscribe([`${F}/r/+/status`, `${F}/r/+/tel`], { qos: 1 });
        this.emit({ connected: true, error: undefined });
      });
      client.on('offline', () => this.emit({ connected: false }));
      client.on('error', (e: Error) => this.emit({ connected: false, error: e.message }));
      client.on('message', async (topic: string, payload: Uint8Array) => {
        const m = new RegExp(`^${F}/r/([A-Z0-9-]{1,24})/(status|tel)$`).exec(topic);
        if (!m || !ID_RE.test(m[1])) return;
        const id = m[1];
        const text = new TextDecoder().decode(payload);
        if (m[2] === 'status') {
          if (text === 'offline') this.upsert(id, { online: false });
          else {
            const st = await channel.open<{ online: boolean; t: number }>(text);
            if (!st) return; // boshqa park kodi bilan shifrlangan
            this.upsert(id, { online: !!st.online });
          }
        } else {
          const tel = await channel.open<RobotTelemetry>(text);
          if (!tel) return;
          const fresh = Date.now() - tel.t < OFFLINE_AFTER_MS;
          this.upsert(id, { tel, lastSeen: tel.t, ...(fresh ? {} : { online: false }) });
        }
        this.emit();
      });
      // Telemetriya to'xtagan robot oflayn deb belgilanadi (LWT kechiksa ham)
      this.sweep = window.setInterval(() => {
        let changed = false;
        this.robots.forEach((r) => {
          if (r.online && r.lastSeen && Date.now() - r.lastSeen > OFFLINE_AFTER_MS) {
            r.online = false;
            changed = true;
          }
        });
        if (changed) this.emit();
      }, 3000);
    } catch (e) {
      this.emit({ connected: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  stop() {
    this.generation++;
    if (this.sweep) window.clearInterval(this.sweep);
    this.sweep = null;
    this.client?.end(true);
    this.client = null;
    this.robots.clear();
    this.emit({ connected: false });
  }
}

export const fleetWatcher = new FleetWatcher();

const SELECTED_KEY = 'qalqon.selectedRobot.v1';
export const selectedRobotStore = {
  get(): string {
    try {
      return localStorage.getItem(SELECTED_KEY) || '';
    } catch {
      return '';
    }
  },
  set(id: string) {
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* saqlanmasa ham ishlaydi */
    }
    window.dispatchEvent(new CustomEvent('qalqon-selected-robot', { detail: id }));
  },
  subscribe(cb: (id: string) => void) {
    const h = (e: Event) => cb((e as CustomEvent<string>).detail);
    window.addEventListener('qalqon-selected-robot', h);
    return () => window.removeEventListener('qalqon-selected-robot', h);
  }
};

// =============================================================================
// TOMOSHABIN (operator): tanlangan robotning videosi + tezkor telemetriyasi
// =============================================================================
export type ViewerState = 'connecting' | 'robot-offline' | 'live' | 'error';

export interface ViewerHandlers {
  onStream: (stream: MediaStream | null) => void;
  onBoxes: (boxes: WireBox[]) => void;
  onState: (state: ViewerState, detail?: string) => void;
  onTelemetry?: (tel: RobotTelemetry) => void;
  /** PTZ kamera moduli oqimi (PTZ / o'ng / chap linzalar bitta kadrda, ustma-ust) */
  onPtzStream?: (stream: MediaStream | null) => void;
}

/** Robot kamerasini kuzatishni boshlash. Qaytgan funksiya ulanishni yopadi */
export function watchRobotCamera(robotId: string, h: ViewerHandlers): () => void {
  const id = rid();
  let closed = false;
  let client: any = null;
  let pc: RTCPeerConnection | null = null;
  let channel: CamChannel | null = null;
  let T = '';
  let robotOnline = false;
  let joinTimer: number | null = null;
  let boxesTimeout: number | null = null;
  let lastBoxesSig = '';
  const pendingIce: RTCIceCandidateInit[] = [];

  const closePeer = () => {
    pc?.close();
    pc = null;
    pendingIce.length = 0;
    h.onStream(null);
    h.onPtzStream?.(null);
    h.onBoxes([]);
    lastBoxesSig = '';
  };

  const publish = (topic: string, obj: unknown) => {
    if (!channel || !client?.connected) return;
    void channel.seal(obj).then((text) => client.publish(topic, text, { qos: 1 }));
  };

  const scheduleJoin = (delay: number) => {
    if (joinTimer) window.clearTimeout(joinTimer);
    joinTimer = window.setTimeout(() => {
      if (closed || !channel) return;
      if (pc && pc.connectionState === 'connected') return;
      if (robotOnline) {
        h.onState('connecting');
        publish(`${T}/join`, { id, name: camLinkSettings.get().operatorName || 'Operator' });
      } else {
        h.onState('robot-offline');
      }
      scheduleJoin(6000);
    }, delay);
  };

  const onOffer = async (sdp: string) => {
    closePeer();
    const peer = new RTCPeerConnection({ iceServers: camLinkSettings.iceServers() });
    pc = peer;
    // 1-video: Face ID kamerasi, 2-video: PTZ kamera moduli (eski robot dasturida faqat birinchisi bo'ladi)
    peer.ontrack = (e) => {
      const stream = new MediaStream([e.track]);
      if (peer.getTransceivers().indexOf(e.transceiver) === 1) h.onPtzStream?.(stream);
      else h.onStream(stream);
    };
    peer.ondatachannel = (e) => {
      e.channel.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { boxes?: WireBox[]; tel?: RobotTelemetry };
          if (msg.tel) h.onTelemetry?.(msg.tel);
          // Ramkalar o'zgarmasa holat yangilanmaydi (10 Hz da keraksiz qayta chizish bo'lmasin)
          const boxes = Array.isArray(msg.boxes) ? msg.boxes : [];
          const sig = JSON.stringify(boxes);
          if (sig !== lastBoxesSig) {
            lastBoxesSig = sig;
            h.onBoxes(boxes);
          }
          if (boxesTimeout) window.clearTimeout(boxesTimeout);
          boxesTimeout = window.setTimeout(() => {
            lastBoxesSig = '';
            h.onBoxes([]);
          }, 1500);
        } catch {
          /* buzilgan xabar */
        }
      };
    };
    peer.onicecandidate = (e) => {
      if (e.candidate) publish(`${T}/v/${id}/ice`, { c: e.candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (peer.connectionState === 'connected') h.onState('live');
      if (peer.connectionState === 'failed') {
        h.onState('error', "Robot bilan to'g'ridan-to'g'ri ulanib bo'lmadi (tarmoq to'sig'i). Sozlamalarda TURN server kiriting");
        closePeer();
        scheduleJoin(5000);
      }
      if (peer.connectionState === 'disconnected') {
        h.onState('connecting');
        scheduleJoin(4000);
      }
    };
    await peer.setRemoteDescription({ type: 'offer', sdp });
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    publish(`${T}/v/${id}/answer`, { sdp: peer.localDescription?.sdp ?? answer.sdp });
    for (const c of pendingIce.splice(0)) await peer.addIceCandidate(c).catch(() => {});
  };

  (async () => {
    try {
      h.onState('connecting');
      channel = await camChannel(camLinkSettings.get().key);
      if (closed) return;
      T = `${channel.topic}/r/${robotId}`;
      client = await connectMqtt();
      if (closed) {
        client.end(true);
        return;
      }
      client.on('connect', () => {
        client.subscribe([`${T}/status`, `${T}/v/${id}/offer`, `${T}/v/${id}/ice-r`], { qos: 1 });
        scheduleJoin(2500);
      });
      client.on('error', (e: Error) => h.onState('connecting', `Signal serveriga ulanish: ${e.message}`));
      client.on('offline', () => h.onState('connecting', "Signal serveri bilan aloqa yo'q, qayta ulanmoqda..."));
      client.on('message', async (topic: string, payload: Uint8Array) => {
        const text = new TextDecoder().decode(payload);
        if (topic === `${T}/status`) {
          const was = robotOnline;
          if (text === 'offline') robotOnline = false;
          else robotOnline = !!(await channel!.open<{ online: boolean }>(text))?.online;
          if (!robotOnline) {
            closePeer();
            h.onState('robot-offline');
          } else if (!was) {
            scheduleJoin(200);
          }
          return;
        }
        if (topic.endsWith('/offer')) {
          const msg = await channel!.open<{ sdp: string }>(text);
          if (msg?.sdp) await onOffer(msg.sdp).catch((e) => h.onState('error', String(e)));
        } else if (topic.endsWith('/ice-r')) {
          const msg = await channel!.open<{ c: RTCIceCandidateInit }>(text);
          if (!msg?.c) return;
          if (pc?.remoteDescription) await pc.addIceCandidate(msg.c).catch(() => {});
          else pendingIce.push(msg.c);
        }
      });
    } catch (e) {
      h.onState('error', e instanceof Error ? e.message : String(e));
    }
  })();

  return () => {
    closed = true;
    if (joinTimer) window.clearTimeout(joinTimer);
    if (boxesTimeout) window.clearTimeout(boxesTimeout);
    pc?.close();
    pc = null;
    client?.end(true);
  };
}
