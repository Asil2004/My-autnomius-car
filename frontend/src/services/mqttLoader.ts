/* eslint-disable @typescript-eslint/no-explicit-any */
/** mqtt.js brauzer kutubxonasini bir marta yuklash (RobotContext bilan bir xil manba) */
const MQTT_SRC = 'https://unpkg.com/mqtt@5.10.4/dist/mqtt.min.js';
export const MQTT_BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

let loading: Promise<any> | null = null;

export function loadMqtt(): Promise<any> {
  const w = window as any;
  if (w.mqtt) return Promise.resolve(w.mqtt);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MQTT_SRC}"]`);
    const script = existing ?? document.createElement('script');
    const done = () => (w.mqtt ? resolve(w.mqtt) : reject(new Error("MQTT kutubxonasi yuklanmadi")));
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', () => reject(new Error("MQTT kutubxonasini yuklab bo'lmadi")), { once: true });
    if (!existing) {
      script.src = MQTT_SRC;
      document.head.appendChild(script);
    } else if (w.mqtt) {
      done();
    }
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
