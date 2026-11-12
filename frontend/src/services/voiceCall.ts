/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "102" OVOZLI CHAQIRUV: fuqaro robot yuzidagi "102" tugmasini bosadi -> parkdagi BARCHA operatorlarga qo'ng'iroq
 * boradi (robot joylashuvi bilan) -> birinchi javob bergan operator bilan ikki tomonlama ovozli aloqa (WebRTC).
 *
 * Signal kanali kamera translyatsiyasi bilan bir xil: park kodidan MQTT mavzusi va AES-GCM kaliti (camChannel).
 *   T = F/r/<ROBOT-ID>
 *   T/call                 robot holati (retained): {state:'ringing'|'active'|'ended', callId, t, lat, lon, by}
 *   T/call/accept          operator -> robot: {callId, opId, name}
 *   T/call/end             istalgan tomon: {callId, by}
 *   T/c/<opId>/offer|ice-r robot -> operator     T/c/<opId>/answer|ice   operator -> robot
 */
import { camChannel, camLinkSettings, type CamChannel } from './camLinkSettings';
import { loadMqtt, MQTT_BROKER_URL } from './mqttLoader';
import { navigationService } from './navigationService';

export type CallState = 'idle' | 'ringing' | 'active' | 'ended';

export interface CallInfo {
  robotId: string;
  state: CallState;
  callId: string;
  t: number;
  lat?: number;
  lon?: number;
  /** Javob bergan operator nomi */
  by?: string;
  /** Shu qurilma suhbatda (operator tomonda: aynan men javob berdim) */
  mine?: boolean;
  /** Suhbat boshlangan vaqt */
  since?: number;
  reason?: string;
}

const RING_TIMEOUT_MS = 90_000;
const rid = () => Math.random().toString(36).slice(2, 10);
const ID_RE = /^[A-Z0-9-]{1,24}$/;

async function connect(): Promise<any> {
  const mqtt = await loadMqtt();
  return mqtt.connect(MQTT_BROKER_URL, {
    clientId: `qalqon_call_${rid()}`,
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 20000,
    keepalive: 30
  });
}

async function openMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false
  });
}

/** Qarama-qarshi tomon ovozi (sahifada ko'rinmas audio element) */
function playRemote(stream: MediaStream): HTMLAudioElement {
  const el = document.createElement('audio');
  el.autoplay = true;
  el.srcObject = stream;
  el.style.display = 'none';
  document.body.appendChild(el);
  void el.play().catch(() => {});
  return el;
}

class Emitter<T> {
  private ls = new Set<(v: T) => void>();
  subscribe(cb: (v: T) => void, current: T) {
    this.ls.add(cb);
    cb(current);
    return () => {
      this.ls.delete(cb);
    };
  }
  emit(v: T) {
    this.ls.forEach((l) => l(v));
  }
}

// =============================================================================
// ROBOT TOMONI
// =============================================================================
class RobotCall {
  private client: any = null;
  private ch: CamChannel | null = null;
  private T = '';
  private gen = 0;
  private info: CallInfo = { robotId: '', state: 'idle', callId: '', t: 0 };
  private em = new Emitter<CallInfo>();
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  private ringTimer: number | null = null;
  private peerOp = '';
  /** Ulanish qayta qurilgan sayin oshadi: eski javob/ICE xabarlari e'tiborsiz qoldiriladi */
  private rev = 0;
  private restarts = 0;
  private discTimer: number | null = null;

  getState() {
    return this.info;
  }
  subscribe(cb: (c: CallInfo) => void) {
    return this.em.subscribe(cb, this.info);
  }
  private set(p: Partial<CallInfo>) {
    this.info = { ...this.info, ...p };
    this.em.emit(this.info);
  }

  async start() {
    if (this.client) return;
    const g = ++this.gen;
    const s = camLinkSettings.get();
    const ch = await camChannel(s.key);
    if (g !== this.gen) return;
    const client = await connect();
    if (g !== this.gen) {
      client.end(true);
      return;
    }
    this.ch = ch;
    this.client = client;
    this.T = `${ch.topic}/r/${s.robotId}`;
    this.set({ robotId: s.robotId });
    const T = this.T;
    client.on('connect', () => {
      client.subscribe([`${T}/call/accept`, `${T}/call/end`, `${T}/c/+/answer`, `${T}/c/+/ice`], { qos: 1 });
    });
    client.on('message', (topic: string, payload: Uint8Array) => void this.onMessage(topic, new TextDecoder().decode(payload)));
  }

  stop() {
    this.gen++;
    this.end('stop', false);
    this.client?.end(true);
    this.client = null;
    this.ch = null;
  }

  private async publish(topic: string, obj: unknown, retain = false) {
    if (!this.ch || !this.client) return;
    const text = await this.ch.seal(obj);
    this.client.publish(topic, text, { qos: 1, retain });
  }

  private publishState() {
    const i = this.info;
    void this.publish(`${this.T}/call`, { state: i.state, callId: i.callId, t: Date.now(), lat: i.lat, lon: i.lon, by: i.by }, true);
  }

  /** "102" bosildi: barcha operatorlarga qo'ng'iroq */
  async ring(): Promise<boolean> {
    if (this.info.state === 'ringing' || this.info.state === 'active') return true;
    if (!this.client) await this.start().catch(() => {});
    if (!this.client) return false;
    try {
      this.mic = await openMic();
    } catch {
      this.set({ state: 'ended', reason: "Mikrofonga ruxsat yo'q" });
      return false;
    }
    const nav = navigationService.getState();
    this.set({
      state: 'ringing',
      callId: rid(),
      t: Date.now(),
      by: undefined,
      since: undefined,
      reason: undefined,
      lat: nav.initialized ? nav.lat : undefined,
      lon: nav.initialized ? nav.lon : undefined
    });
    this.publishState();
    this.ringTimer = window.setTimeout(() => this.end("Operator javob bermadi"), RING_TIMEOUT_MS);
    return true;
  }

  /** Robot tomonda qo'ng'iroqni tugatish */
  hangup() {
    if (this.info.state === 'ringing' || this.info.state === 'active') this.end('Fuqaro tugatdi');
  }

  private end(reason: string, publish = true) {
    if (this.ringTimer) window.clearTimeout(this.ringTimer);
    this.ringTimer = null;
    if (this.discTimer) window.clearTimeout(this.discTimer);
    this.discTimer = null;
    this.restarts = 0;
    this.pc?.close();
    this.pc = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (this.audio) {
      this.audio.srcObject = null;
      this.audio.remove();
      this.audio = null;
    }
    this.pendingIce = [];
    this.remoteSet = false;
    this.peerOp = '';
    if (this.info.state === 'idle' || this.info.state === 'ended') return;
    this.set({ state: 'ended', reason });
    if (publish) this.publishState();
  }

  private async onMessage(topic: string, text: string) {
    const ch = this.ch;
    if (!ch) return;
    const T = this.T;
    if (topic === `${T}/call/accept`) {
      const m = await ch.open<{ callId: string; opId: string; name?: string }>(text);
      if (!m || m.callId !== this.info.callId || this.info.state !== 'ringing' || !/^[a-z0-9]{4,16}$/.test(m.opId)) return;
      if (this.ringTimer) window.clearTimeout(this.ringTimer);
      this.ringTimer = null;
      this.peerOp = m.opId;
      this.set({ state: 'active', by: (m.name || 'Operator').slice(0, 40), since: Date.now() });
      this.publishState();
      await this.createPeer(m.opId);
      return;
    }
    if (topic === `${T}/call/end`) {
      const m = await ch.open<{ callId: string; by?: string }>(text);
      if (m && m.callId === this.info.callId) this.end(`${m.by || 'Operator'} tugatdi`, true);
      return;
    }
    const mm = /\/c\/([a-z0-9]{4,16})\/(answer|ice)$/.exec(topic);
    if (!mm || mm[1] !== this.peerOp || !this.pc) return;
    if (mm[2] === 'answer') {
      const m = await ch.open<{ sdp: string; callId: string; rev?: number }>(text);
      if (!m?.sdp || m.callId !== this.info.callId || (m.rev ?? 0) !== this.rev || this.remoteSet) return;
      await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => {});
      this.remoteSet = true;
      for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
    } else {
      const m = await ch.open<{ c: RTCIceCandidateInit; callId: string; rev?: number }>(text);
      if (!m?.c || m.callId !== this.info.callId || (m.rev ?? 0) !== this.rev) return;
      if (this.remoteSet) await this.pc.addIceCandidate(m.c).catch(() => {});
      else this.pendingIce.push(m.c);
    }
  }

  /**
   * Aloqa uzilsa (tarmoq yo'li o'zgardi, Wi-Fi/mobil almashdi) ulanish yangidan quriladi: suhbat tugamaydi,
   * operator tomoni yangi taklifni qabul qilib o'zi qayta ulanadi. 6 marta urinib bo'lmasa suhbat tugaydi.
   */
  private restartPeer() {
    if (this.info.state !== 'active' || !this.peerOp) return;
    if (++this.restarts > 6) {
      this.end('Aloqa uzildi');
      return;
    }
    console.warn(`[102] Aloqa uzildi, qayta ulanish (${this.restarts})`);
    void this.createPeer(this.peerOp);
  }

  private async createPeer(opId: string) {
    const T = this.T;
    const callId = this.info.callId;
    if (this.discTimer) window.clearTimeout(this.discTimer);
    this.discTimer = null;
    this.pc?.close();
    const rev = ++this.rev;
    this.remoteSet = false;
    this.pendingIce = [];
    const pc = new RTCPeerConnection({ iceServers: camLinkSettings.iceServers() });
    this.pc = pc;
    this.mic?.getAudioTracks().forEach((tr) => pc.addTrack(tr, this.mic!));
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      if (!this.audio) this.audio = playRemote(stream);
      else {
        this.audio.srcObject = stream;
        void this.audio.play().catch(() => {});
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.publish(`${T}/c/${opId}/ice-r`, { c: e.candidate.toJSON(), callId, rev });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') {
        this.restarts = 0;
        if (this.discTimer) window.clearTimeout(this.discTimer);
        this.discTimer = null;
      } else if (st === 'failed') {
        this.restartPeer();
      } else if (st === 'disconnected' && !this.discTimer) {
        // Qisqa uzilishlar o'zi tiklanadi; 2.5 s dan oshsa qayta quramiz
        this.discTimer = window.setTimeout(() => {
          this.discTimer = null;
          if (this.pc === pc && pc.connectionState !== 'connected') this.restartPeer();
        }, 2500);
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    void this.publish(`${T}/c/${opId}/offer`, { sdp: pc.localDescription?.sdp ?? offer.sdp, callId, rev });
  }

  /** Sinov/diagnostika uchun: ulanishni majburan qayta qurish */
  forceReconnect() {
    this.restartPeer();
  }
}

export const robotCall = new RobotCall();

// =============================================================================
// OPERATOR TOMONI: parkdagi barcha robotlarning chaqiruvlari
// =============================================================================
class OperatorCalls {
  private client: any = null;
  private ch: CamChannel | null = null;
  private F = '';
  private gen = 0;
  private opId = rid();
  private calls = new Map<string, CallInfo>();
  private em = new Emitter<CallInfo[]>();
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private pendingIce: { rev: number; c: RTCIceCandidateInit }[] = [];
  private remoteSet = false;
  /** Robot tomonidan qayta qurilgan ulanish raqami */
  private rev = 0;
  /** Men javob bergan chaqiruv */
  private my: { robotId: string; callId: string } | null = null;

  list(): CallInfo[] {
    return [...this.calls.values()];
  }
  subscribe(cb: (c: CallInfo[]) => void) {
    return this.em.subscribe(cb, this.list());
  }
  private emit() {
    this.em.emit(this.list());
  }

  async start() {
    if (this.client) return;
    const g = ++this.gen;
    const ch = await camChannel(camLinkSettings.get().key);
    if (g !== this.gen) return;
    const client = await connect();
    if (g !== this.gen) {
      client.end(true);
      return;
    }
    this.ch = ch;
    this.client = client;
    this.F = ch.topic;
    const F = this.F;
    client.on('connect', () => {
      client.subscribe([`${F}/r/+/call`, `${F}/r/+/c/${this.opId}/offer`, `${F}/r/+/c/${this.opId}/ice-r`], { qos: 1 });
    });
    client.on('message', (topic: string, payload: Uint8Array) => void this.onMessage(topic, new TextDecoder().decode(payload)));
  }

  stop() {
    this.gen++;
    this.hangup();
    this.client?.end(true);
    this.client = null;
    this.ch = null;
    this.calls.clear();
    this.emit();
  }

  private async publish(topic: string, obj: unknown) {
    if (!this.ch || !this.client) return;
    this.client.publish(topic, await this.ch.seal(obj), { qos: 1 });
  }

  private async onMessage(topic: string, text: string) {
    const ch = this.ch;
    if (!ch) return;
    const F = this.F;
    let m = new RegExp(`^${F}/r/([A-Z0-9-]{1,24})/call$`).exec(topic);
    if (m && ID_RE.test(m[1])) {
      const robotId = m[1];
      if (!text) return;
      const st = await ch.open<{ state: CallState; callId: string; t: number; lat?: number; lon?: number; by?: string }>(text);
      if (!st) return;
      const fresh = Date.now() - st.t < (st.state === 'active' ? 30 * 60_000 : RING_TIMEOUT_MS);
      const mine = this.my?.robotId === robotId && this.my.callId === st.callId;
      if (st.state === 'ended' || !fresh) {
        if (mine) this.closeLocal();
        this.calls.delete(robotId);
      } else {
        const prev = this.calls.get(robotId);
        this.calls.set(robotId, {
          robotId,
          state: st.state,
          callId: st.callId,
          t: st.t,
          lat: st.lat,
          lon: st.lon,
          by: st.by,
          mine,
          since: st.state === 'active' ? prev?.since ?? Date.now() : undefined
        });
      }
      this.emit();
      return;
    }
    m = new RegExp(`^${F}/r/([A-Z0-9-]{1,24})/c/${this.opId}/(offer|ice-r)$`).exec(topic);
    if (!m || !this.my || m[1] !== this.my.robotId) return;
    if (m[2] === 'offer') {
      const o = await ch.open<{ sdp: string; callId: string; rev?: number }>(text);
      if (!o?.sdp || o.callId !== this.my.callId || (o.rev ?? 0) < this.rev) return;
      // Yangi taklif (robot aloqani qayta qurdi): eski ulanish yopilib, yangisi quriladi
      await this.answer(m[1], o.sdp, o.rev ?? 0);
    } else {
      const o = await ch.open<{ c: RTCIceCandidateInit; callId: string; rev?: number }>(text);
      if (!o?.c || o.callId !== this.my.callId) return;
      const rev = o.rev ?? 0;
      if (rev === this.rev && this.pc && this.remoteSet) await this.pc.addIceCandidate(o.c).catch(() => {});
      else if (rev >= this.rev) this.pendingIce.push({ rev, c: o.c });
    }
  }

  /** Chaqiruvga javob berish (mikrofon ruxsati so'raladi) */
  async accept(robotId: string): Promise<boolean> {
    const c = this.calls.get(robotId);
    if (!c || c.state !== 'ringing' || !this.client) return false;
    if (this.my) this.hangup();
    try {
      this.mic = await openMic();
    } catch {
      return false;
    }
    this.my = { robotId, callId: c.callId };
    this.rev = 0;
    this.pendingIce = [];
    const name = camLinkSettings.get().operatorName || 'Operator';
    await this.publish(`${this.F}/r/${robotId}/call/accept`, { callId: c.callId, opId: this.opId, name });
    return true;
  }

  private async answer(robotId: string, sdp: string, rev: number) {
    const T = `${this.F}/r/${robotId}`;
    const callId = this.my!.callId;
    this.pc?.close();
    this.rev = rev;
    const pc = new RTCPeerConnection({ iceServers: camLinkSettings.iceServers() });
    this.pc = pc;
    this.remoteSet = false;
    this.mic?.getAudioTracks().forEach((tr) => pc.addTrack(tr, this.mic!));
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      if (!this.audio) this.audio = playRemote(stream);
      else {
        this.audio.srcObject = stream;
        void this.audio.play().catch(() => {});
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.publish(`${T}/c/${this.opId}/ice`, { c: e.candidate.toJSON(), callId, rev });
    };
    // Uzilishlarni robot tomoni boshqaradi (yangi taklif yuboradi); bu yerda faqat holat
    await pc.setRemoteDescription({ type: 'offer', sdp });
    this.remoteSet = true;
    const pend = this.pendingIce.filter((p) => p.rev === rev);
    this.pendingIce = this.pendingIce.filter((p) => p.rev > rev);
    for (const p of pend) await pc.addIceCandidate(p.c).catch(() => {});
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await this.publish(`${T}/c/${this.opId}/answer`, { sdp: pc.localDescription?.sdp ?? ans.sdp, callId, rev });
  }

  /** Suhbatni tugatish (yoki chaqiruvni men uchun yopish) */
  hangup() {
    const my = this.my;
    if (my) {
      const name = camLinkSettings.get().operatorName || 'Operator';
      void this.publish(`${this.F}/r/${my.robotId}/call/end`, { callId: my.callId, by: name });
    }
    this.closeLocal();
    this.emit();
  }

  /** Chaqiruvni rad etish: faqat shu operator ekranidan yashiriladi (boshqa operatorlar javob berishi mumkin) */
  dismiss(robotId: string) {
    this.calls.delete(robotId);
    this.emit();
  }

  getAudioLevelStream(): MediaStream | null {
    return this.mic;
  }

  private closeLocal() {
    this.pc?.close();
    this.pc = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (this.audio) {
      this.audio.srcObject = null;
      this.audio.remove();
      this.audio = null;
    }
    this.pendingIce = [];
    this.remoteSet = false;
    if (this.my) {
      const c = this.calls.get(this.my.robotId);
      if (c) this.calls.set(this.my.robotId, { ...c, mine: false });
    }
    this.my = null;
  }

  isMine(robotId: string) {
    return this.my?.robotId === robotId;
  }
}

export const operatorCalls = new OperatorCalls();
