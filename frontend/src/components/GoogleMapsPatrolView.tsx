import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Layers,
  Play,
  Square,
  Trash2,
  Crosshair,
  Wifi,
  WifiOff,
  Navigation,
  Compass,
  Cpu,
  Battery,
  Sparkles,
  Radio,
  PenLine,
  Check,
  Undo2
} from 'lucide-react';
import { useRobot } from '../context/RobotContext';

// Default center: Navoiy street (Opposite Qizilqum 13 & Navoiy City)
const NAVOI_CENTER: [number, number] = [40.09985, 65.36835];

// High-fidelity SVG Digital Twin Robot
const ROBOT_SVG_CONTENT = `
  <div id="react-robot-marker-svg" style="width: 56px; height: 58px; transform: rotate(0deg); transition: transform 0.1s linear; transform-origin: center center; filter: drop-shadow(0 0 8px rgba(0, 229, 255, 0.6));">
    <svg viewBox="0 0 56 58" width="56" height="58">
      <!-- 360° LiDAR radar sweep circle -->
      <circle cx="28" cy="29" r="26" fill="rgba(0, 229, 255, 0.15)" stroke="rgba(0, 229, 255, 0.5)" stroke-width="1.2" stroke-dasharray="3,2"/>
      <line x1="28" y1="29" x2="28" y2="3" stroke="#00e5ff" stroke-width="2" opacity="0.85"/>

      <!-- 4x All-Terrain Mecanum Shina (130mm x 60mm) -->
      <rect x="2" y="6" width="8" height="14" rx="2" fill="#0f172a" stroke="#38bdf8" stroke-width="1.2"/>
      <rect x="46" y="6" width="8" height="14" rx="2" fill="#0f172a" stroke="#38bdf8" stroke-width="1.2"/>
      <rect x="2" y="38" width="8" height="14" rx="2" fill="#0f172a" stroke="#38bdf8" stroke-width="1.2"/>
      <rect x="46" y="38" width="8" height="14" rx="2" fill="#0f172a" stroke="#38bdf8" stroke-width="1.2"/>

      <!-- Alyuminiy shassi plitasi -->
      <rect x="9" y="8" width="38" height="42" rx="4" fill="#1e293b" stroke="#64748b" stroke-width="1.5"/>

      <!-- Ø 500 mm Monolit Oq Gumbaz -->
      <circle cx="28" cy="29" r="20" fill="#f8fafc" stroke="#0284c7" stroke-width="2.5"/>
      
      <!-- Politsiya ko'k chizig'i -->
      <path d="M 12 29 Q 28 32 44 29" stroke="#1e3a8a" stroke-width="3" fill="none"/>

      <!-- Old 8.7" Planshet (AI Ko'zlar) -->
      <rect x="21" y="11" width="14" height="6" rx="1.5" fill="#020617" stroke="#00e5ff" stroke-width="1"/>
      <circle cx="25" cy="14" r="1.2" fill="#00e5ff"/>
      <circle cx="31" cy="14" r="1.2" fill="#00e5ff"/>

      <!-- Teleskopik Minora & 360° Stroboskop -->
      <circle cx="28" cy="29" r="6" fill="#ef4444" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="28" cy="29" r="2" fill="#ffffff"/>

      <!-- Yo'nalish vektori ko'rsatkichi -->
      <polygon points="28,1 24,7 32,7" fill="#00e5ff"/>
    </svg>
  </div>
`;

interface Waypoint {
  lat: number;
  lon: number;
}

export const GoogleMapsPatrolView: React.FC = () => {
  const { system, gps, startRealGPS, toggleGPSMode } = useRobot();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const robotMarkerRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const waypointMarkersRef = useRef<L.CircleMarker[]>([]);

  // Modes & Statuses
  const [mode, setMode] = useState<'demo' | 'real'>('demo');
  const [mapLayerType, setMapLayerType] = useState<'hybrid' | 'roadmap'>('hybrid');
  const [isPatrolling, setIsPatrolling] = useState(false);
  const [routingStatus, setRoutingStatus] = useState<string>("Nuqtalar qo'yilmagan");

  // Real Raspberry Pi WebSocket state
  const [robotIp, setRobotIp] = useState<string>(system.rpiIp || '192.168.1.100:8000');
  const [isConnectedPi, setIsConnectedPi] = useState(false);
  const [isConnectingPi, setIsConnectingPi] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Telemetry state
  const [telemetry, setTelemetry] = useState({
    lat: NAVOI_CENTER[0],
    lon: NAVOI_CENTER[1],
    heading: 135,
    speed: 0,
    lidarHz: 10,
    batteryVoltage: 13.2,
    batteryPercent: 92
  });

  // Waypoints & Path
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const detailedNodesRef = useRef<[number, number][]>([]);
  const currentPathIndexRef = useRef<number>(0);
  const patrolIntervalRef = useRef<any>(null);

  // Tile layer references
  const hybridLayerRef = useRef<L.TileLayer | null>(null);
  const roadmapLayerRef = useRef<L.TileLayer | null>(null);

  // Update robot marker DOM rotation and latlng
  const setRobotVisual = useCallback((lat: number, lon: number, heading: number) => {
    if (robotMarkerRef.current) {
      robotMarkerRef.current.setLatLng([lat, lon]);
    }
    const svgElem = document.getElementById('react-robot-marker-svg');
    if (svgElem) {
      svgElem.style.transform = `rotate(${heading}deg)`;
    }
  }, []);

  // Update Polyline on map
  const renderPolyline = useCallback((nodes: [number, number][]) => {
    if (!mapRef.current) return;
    if (polylineRef.current) {
      mapRef.current.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }
    if (nodes.length > 1) {
      polylineRef.current = L.polyline(nodes, {
        color: '#00e5ff',
        weight: 4,
        opacity: 0.85,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(mapRef.current);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // OPERATOR MARSHRUT CHIZISHI: "Marshrut chizish" tugmasi bilan yoqiladi/o'chiriladi.
  // 1-bosish: chiziq boshlanadi (sichqonchaga ergashuvchi punktir chiziq). Keyingi har bosishda chiziq shu nuqtada
  // tugaydi va o'sha joydan yangi chiziq boshlanadi. Tugma qayta bosilsa (yoki Esc) chizish tugaydi.
  // Robot aynan operator chizgan chiziq bo'ylab yuradi; oxiriga yetgach, xuddi shu yo'l bilan orqaga qaytadi.
  // ---------------------------------------------------------------------------
  const waypointsRef = useRef<Waypoint[]>([]);
  const drawModeRef = useRef(false);
  const previewLineRef = useRef<L.Polyline | null>(null);
  const patrolDirRef = useRef<1 | -1>(1);
  const [drawMode, setDrawMode] = useState(false);

  const routeLengthM = useCallback((pts: Waypoint[]) => {
    let sum = 0;
    for (let i = 1; i < pts.length; i++) {
      sum += L.latLng(pts[i - 1].lat, pts[i - 1].lon).distanceTo(L.latLng(pts[i].lat, pts[i].lon));
    }
    return sum;
  }, []);

  const removePreview = useCallback(() => {
    if (previewLineRef.current && mapRef.current) mapRef.current.removeLayer(previewLineRef.current);
    previewLineRef.current = null;
  }, []);

  /** Nuqtalar, chiziq va holat matnini waypointsRef bo'yicha qayta chizish */
  const syncRoute = useCallback(() => {
    const pts = waypointsRef.current;
    setWaypoints([...pts]);
    detailedNodesRef.current = pts.map(p => [p.lat, p.lon]);
    currentPathIndexRef.current = 0;
    patrolDirRef.current = 1;
    renderPolyline(detailedNodesRef.current);
    if (pts.length === 0) setRoutingStatus("Marshrut yo'q. \"Marshrut chizish\" tugmasini bosing.");
    else if (pts.length === 1) setRoutingStatus('Boshlang\'ich nuqta qo\'yildi. Keyingi nuqtani bosing.');
    else {
      const m = routeLengthM(pts);
      setRoutingStatus(`✅ ${pts.length - 1} ta chiziq, ${m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`}`);
    }
  }, [renderPolyline, routeLengthM]);

  const makeVertexMarker = (lat: number, lon: number, idx: number) =>
    L.circleMarker([lat, lon], {
      radius: idx === 1 ? 7 : 5,
      fillColor: idx === 1 ? '#10b981' : '#00e5ff',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.95,
      bubblingMouseEvents: false
    }).bindTooltip(`${idx}-nuqta`, { direction: 'top', offset: [0, -6] });

  // Chizish rejimida xaritaga bosilganda nuqta qo'shish (faqat ref'lar ishlatiladi: xarita bir marta sozlanadi)
  const addWaypoint = useCallback((lat: number, lon: number) => {
    if (!mapRef.current) return;
    waypointsRef.current = [...waypointsRef.current, { lat, lon }];
    const marker = makeVertexMarker(lat, lon, waypointsRef.current.length).addTo(mapRef.current);
    waypointMarkersRef.current.push(marker);
    removePreview();
    syncRoute();
  }, [removePreview, syncRoute]);

  // Sichqoncha harakatida oxirgi nuqtadan kursorgacha punktir chiziq
  const updatePreview = useCallback((latlng: L.LatLng) => {
    const map = mapRef.current;
    const last = waypointsRef.current[waypointsRef.current.length - 1];
    if (!map || !drawModeRef.current || !last) return;
    const pts: L.LatLngExpression[] = [[last.lat, last.lon], latlng];
    if (previewLineRef.current) previewLineRef.current.setLatLngs(pts);
    else {
      previewLineRef.current = L.polyline(pts, {
        color: '#fbbf24',
        weight: 3,
        opacity: 0.9,
        dashArray: '6 6',
        interactive: false
      }).addTo(map);
    }
  }, []);

  const stopPatrolRef = useRef<() => void>(() => {});

  const setDrawing = useCallback((on: boolean) => {
    const map = mapRef.current;
    drawModeRef.current = on;
    setDrawMode(on);
    if (!map) return;
    const el = map.getContainer();
    if (on) {
      stopPatrolRef.current();
      map.doubleClickZoom.disable(); // ikki marta tez bosish nuqta qo'yadi, xaritani kattalashtirmaydi
      el.style.cursor = 'crosshair';
      setRoutingStatus(
        waypointsRef.current.length
          ? 'Chizish davom etmoqda: keyingi nuqtani bosing.'
          : "Chizish yoqildi: xaritada boshlang'ich nuqtani bosing."
      );
    } else {
      removePreview();
      map.doubleClickZoom.enable();
      el.style.cursor = '';
      syncRoute();
    }
  }, [removePreview, syncRoute]);

  const toggleDrawMode = useCallback(() => setDrawing(!drawModeRef.current), [setDrawing]);

  // Oxirgi nuqtani bekor qilish
  const undoLastWaypoint = useCallback(() => {
    if (!mapRef.current || waypointsRef.current.length === 0) return;
    waypointsRef.current = waypointsRef.current.slice(0, -1);
    const m = waypointMarkersRef.current.pop();
    if (m) mapRef.current.removeLayer(m);
    removePreview();
    syncRoute();
  }, [removePreview, syncRoute]);

  // Clear waypoints
  const clearWaypoints = useCallback(() => {
    if (patrolIntervalRef.current) {
      clearInterval(patrolIntervalRef.current);
      patrolIntervalRef.current = null;
    }
    setIsPatrolling(false);
    waypointsRef.current = [];
    removePreview();

    if (mapRef.current) {
      waypointMarkersRef.current.forEach(m => mapRef.current?.removeLayer(m));
      waypointMarkersRef.current = [];
    }
    syncRoute();
    setTelemetry(prev => ({ ...prev, speed: 0 }));
  }, [removePreview, syncRoute]);

  // Esc: chizishni tugatish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawModeRef.current) setDrawing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDrawing]);

  // Haqiqiy GPS ma'lumotlarini telemetriyaga sinxronlash
  useEffect(() => {
    if (gps.isReal) {
      setTelemetry(prev => ({
        ...prev,
        lat: gps.latitude,
        lon: gps.longitude,
        speed: gps.speed || 0,
        heading: gps.heading || prev.heading
      }));
      setRobotVisual(gps.latitude, gps.longitude, gps.heading || 0);
    }
  }, [gps.isReal, gps.latitude, gps.longitude, gps.speed, gps.heading, setRobotVisual]);

  const goToRealGPS = useCallback(() => {
    if (!mapRef.current) return;
    startRealGPS();
    mapRef.current.setView([gps.latitude, gps.longitude], 19);
    setRobotVisual(gps.latitude, gps.longitude, gps.heading || 0);
    setTelemetry(prev => ({
      ...prev,
      lat: gps.latitude,
      lon: gps.longitude,
      speed: gps.speed || 0,
      heading: gps.heading || prev.heading
    }));
  }, [gps, startRealGPS, setRobotVisual]);

  // Start Demo Patrol Simulation Loop
  const startPatrol = useCallback(() => {
    if (detailedNodesRef.current.length < 2) {
      setRoutingStatus("Avval \"Marshrut chizish\" tugmasini bosib, xaritada kamida 2 ta nuqta qo'ying.");
      return;
    }
    if (drawModeRef.current) setDrawing(false);

    setIsPatrolling(true);

    if (patrolIntervalRef.current) clearInterval(patrolIntervalRef.current);

    patrolIntervalRef.current = setInterval(() => {
      const nodes = detailedNodesRef.current;
      if (nodes.length === 0) return;

      setTelemetry(prev => {
        const target = nodes[currentPathIndexRef.current];
        const dLat = target[0] - prev.lat;
        const dLon = target[1] - prev.lon;
        const dist = Math.hypot(dLat, dLon);

        if (dist < 0.000015) {
          // Chizilgan yo'l oxiriga yetganda o'sha yo'l bilan orqaga qaytadi (uylar ustidan to'g'ri kesib o'tmaydi)
          let next = currentPathIndexRef.current + patrolDirRef.current;
          if (next >= nodes.length || next < 0) {
            patrolDirRef.current = patrolDirRef.current === 1 ? -1 : 1;
            next = currentPathIndexRef.current + patrolDirRef.current;
          }
          currentPathIndexRef.current = Math.max(0, Math.min(nodes.length - 1, next));
          return prev;
        }

        const targetHeading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
        let headingDiff = targetHeading - prev.heading;
        if (headingDiff > 180) headingDiff -= 360;
        if (headingDiff < -180) headingDiff += 360;

        const newHeading = (prev.heading + headingDiff * 0.25 + 360) % 360;
        const step = 0.000010; // ~1m step at 10Hz => ~1.2m/s
        const newLat = prev.lat + Math.cos(newHeading * Math.PI / 180) * step;
        const newLon = prev.lon + Math.sin(newHeading * Math.PI / 180) * step;

        setRobotVisual(newLat, newLon, newHeading);

        return {
          ...prev,
          lat: newLat,
          lon: newLon,
          heading: newHeading,
          speed: 1.2
        };
      });
    }, 100);
  }, [setRobotVisual, setDrawing]);

  const stopPatrol = useCallback(() => {
    setIsPatrolling(false);
    if (patrolIntervalRef.current) {
      clearInterval(patrolIntervalRef.current);
      patrolIntervalRef.current = null;
    }
    setTelemetry(prev => ({ ...prev, speed: 0 }));
  }, []);
  stopPatrolRef.current = stopPatrol;

  // Raspberry Pi WebSocket Connection
  const togglePiConnection = useCallback(() => {
    if (isConnectedPi) {
      if (wsRef.current) wsRef.current.close();
      return;
    }

    setIsConnectingPi(true);
    const wsUrl = `ws://${robotIp.trim()}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnectedPi(true);
        setIsConnectingPi(false);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.gps && data.gps.has_fix) {
            const rLat = data.gps.latitude;
            const rLon = data.gps.longitude;
            const rHeading = data.gps.heading || 0;
            const rSpeed = data.gps.speed || 0;

            setTelemetry(prev => ({
              ...prev,
              lat: rLat,
              lon: rLon,
              heading: rHeading,
              speed: rSpeed
            }));

            setRobotVisual(rLat, rLon, rHeading);
            if (mapRef.current) {
              mapRef.current.panTo([rLat, rLon]);
            }
          }

          if (data.battery) {
            setTelemetry(prev => ({
              ...prev,
              batteryVoltage: data.battery.voltage,
              batteryPercent: data.battery.percent
            }));
          }
        } catch {
          // ignore invalid parse
        }
      };

      ws.onclose = () => {
        setIsConnectedPi(false);
        setIsConnectingPi(false);
      };

      ws.onerror = () => {
        setIsConnectedPi(false);
        setIsConnectingPi(false);
      };
    } catch {
      setIsConnectingPi(false);
      setIsConnectedPi(false);
    }
  }, [isConnectedPi, robotIp, setRobotVisual]);

  // Layer switch
  const switchMapLayer = (type: 'hybrid' | 'roadmap') => {
    setMapLayerType(type);
    if (!mapRef.current || !hybridLayerRef.current || !roadmapLayerRef.current) return;

    if (type === 'hybrid') {
      mapRef.current.removeLayer(roadmapLayerRef.current);
      mapRef.current.addLayer(hybridLayerRef.current);
    } else {
      mapRef.current.removeLayer(hybridLayerRef.current);
      mapRef.current.addLayer(roadmapLayerRef.current);
    }
  };

  // Center Map on Navoiy
  const centerMap = () => {
    if (mapRef.current) {
      mapRef.current.setView(NAVOI_CENTER, 19);
    }
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return; // already initialized

    const hybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: 'Google Maps Satellite'
    });
    hybridLayerRef.current = hybrid;

    const roadmap = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: 'Google Maps'
    });
    roadmapLayerRef.current = roadmap;

    const map = L.map(mapContainerRef.current, {
      center: NAVOI_CENTER,
      zoom: 19,
      layers: [hybrid],
      zoomControl: false // custom tactical placement or handled cleanly
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    // Custom Robot DivIcon
    const robotIcon = L.divIcon({
      html: ROBOT_SVG_CONTENT,
      className: 'custom-robot-icon',
      iconSize: [56, 58],
      iconAnchor: [28, 29]
    });

    robotMarkerRef.current = L.marker(NAVOI_CENTER, { icon: robotIcon }).addTo(map);
    mapRef.current = map;

    // Faqat "Marshrut chizish" yoqilganda bosish nuqta qo'yadi
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (drawModeRef.current) addWaypoint(e.latlng.lat, e.latlng.lng);
    });
    map.on('mousemove', (e: L.LeafletMouseEvent) => updatePreview(e.latlng));
    map.on('mouseout', () => removePreview());

    // Invalidate size to guarantee full container rendering (test marshruti endi avtomatik yuklanmaydi)
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      if (patrolIntervalRef.current) clearInterval(patrolIntervalRef.current);
      if (wsRef.current) wsRef.current.close();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="flex-1 flex w-full h-full relative overflow-hidden bg-[#06090e] select-none">
      {/* MAP CANVAS */}
      <div ref={mapContainerRef} className="flex-1 h-full w-full z-0 bg-[#070c14]" />

      {/* TOP FLOATING HUD BAR */}
      <div className="absolute top-3 left-3 right-16 z-20 pointer-events-none flex items-center justify-between">
        <div className="pointer-events-auto flex items-center gap-2 bg-tactical-950/90 border border-tactical-700/80 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-xl">
          <span className="px-2 py-0.5 rounded bg-police-cyan/20 border border-police-cyan text-police-cyan font-mono text-xs font-bold tracking-wider">
            GOOGLE MAPS SLAM
          </span>
          <span className="text-xs font-semibold text-slate-200">
            QALQON v1.0 — DIGITAL TWIN &amp; AVTONOM PATRUL
          </span>
          <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-tactical-700">
            <span className={`w-2.5 h-2.5 rounded-full ${mode === 'demo' ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b]' : 'bg-emerald-400 shadow-[0_0_8px_#10b981]'}`} />
            <span className="text-[11px] font-mono font-bold text-slate-300">
              {mode === 'demo' ? 'DEMO SIMULYATSIYA' : 'REAL RASPBERRY PI'}
            </span>
          </div>
        </div>

        {/* Quick Map Layer Toggles */}
        <div className="pointer-events-auto flex items-center gap-1 bg-tactical-950/90 border border-tactical-700/80 backdrop-blur-md p-1 rounded-lg shadow-xl">
          <button
            onClick={() => switchMapLayer('hybrid')}
            className={`px-2.5 py-1 text-[11px] font-mono rounded transition-all flex items-center gap-1 ${
              mapLayerType === 'hybrid'
                ? 'bg-police-blue text-white font-bold shadow-[0_0_8px_rgba(29,99,255,0.5)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Hybrid (Sun'iy yo'ldosh)
          </button>
          <button
            onClick={() => switchMapLayer('roadmap')}
            className={`px-2.5 py-1 text-[11px] font-mono rounded transition-all flex items-center gap-1 ${
              mapLayerType === 'roadmap'
                ? 'bg-police-blue text-white font-bold shadow-[0_0_8px_rgba(29,99,255,0.5)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Navigation className="w-3.5 h-3.5" />
            Ko'cha (Roadmap)
          </button>
          <button
            onClick={centerMap}
            title="Xaritani Navoiy markaziga qaratish"
            className="p-1 rounded text-slate-400 hover:text-police-cyan transition-all"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* RIGHT SIDEBAR CONTROLS & TELEMETRY */}
      <div className="absolute right-3 top-14 bottom-3 w-[21rem] max-w-[calc(100%-1.5rem)] z-20 flex flex-col gap-2.5 overflow-y-auto pr-1 pointer-events-auto">
        {/* REJIM TANLASH CARD */}
        <div className="bg-tactical-950/90 border border-tactical-800/80 backdrop-blur-md rounded-xl p-3 shadow-xl">
          <div className="text-[10px] font-mono font-bold text-police-cyan uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Ishlash Rejimi</span>
            <Sparkles className="w-3 h-3 text-police-cyan" />
          </div>
          <div className="flex bg-tactical-900 border border-tactical-700/60 rounded-lg p-0.5">
            <button
              onClick={() => {
                setMode('demo');
              }}
              className={`flex-1 py-1.5 text-xs font-mono font-bold rounded transition-all ${
                mode === 'demo'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🎮 DEMO REJIM
            </button>
            <button
              onClick={() => {
                setMode('real');
                stopPatrol();
              }}
              className={`flex-1 py-1.5 text-xs font-mono font-bold rounded transition-all ${
                mode === 'real'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ⚡ REAL (RPi 4)
            </button>
          </div>
        </div>

        {/* DEMO PATROL CONTROLS */}
        {mode === 'demo' && (
          <div className="bg-tactical-950/90 border border-tactical-800/80 backdrop-blur-md rounded-xl p-3 shadow-xl flex flex-col gap-2">
            <div className="text-[10px] font-mono font-bold text-police-cyan uppercase tracking-wider flex items-center justify-between">
              <span>Demo Avtonom Navigatsiya</span>
              <span className={`text-[10px] font-bold ${isPatrolling ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isPatrolling ? 'FAOL PATRUL' : 'KUTISHDA'}
              </span>
            </div>

            <div className="bg-tactical-900/90 border border-tactical-800 rounded p-2 text-[10px] font-mono flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Marshrut:</span>
                <span className="text-police-cyan font-bold">{waypoints.length} ta waypoint</span>
              </div>
              <div className="text-emerald-400 font-bold truncate">{routingStatus}</div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={startPatrol}
                disabled={isPatrolling}
                className="py-2 px-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-mono text-xs font-bold flex items-center justify-center gap-1.5 shadow transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                Patrulni Boshlash
              </button>
              <button
                onClick={stopPatrol}
                disabled={!isPatrolling}
                className="py-2 px-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded font-mono text-xs font-bold flex items-center justify-center gap-1.5 shadow transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
                To'xtatish
              </button>
            </div>

            {/* Presets */}
              <button
                onClick={goToRealGPS}
                className="w-full py-1.5 px-2 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/60 text-emerald-200 hover:text-white rounded font-mono text-[11px] flex items-center gap-1.5 transition-all text-left truncate"
              >
                <Crosshair className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>🎯 Haqiqiy GPS Joylashuvim ({gps.latitude.toFixed(4)}, {gps.longitude.toFixed(4)})</span>
              </button>

            {/* Operator marshrut chizishi */}
            <button
              onClick={toggleDrawMode}
              className={`w-full py-2 px-2 rounded font-mono text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                drawMode
                  ? 'bg-amber-500 hover:bg-amber-400 text-tactical-950 border-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.6)]'
                  : 'bg-police-blue/30 hover:bg-police-blue/50 text-white border-police-cyan/50'
              }`}
            >
              {drawMode ? <Check className="w-3.5 h-3.5" /> : <PenLine className="w-3.5 h-3.5" />}
              {drawMode ? 'Chizishni tugatish' : 'Marshrut chizish'}
            </button>
            {drawMode && (
              <div className="text-[10px] font-mono text-amber-300 leading-snug">
                Xaritaga bosing: har bosishda chiziq shu yerda tugaydi va yangisi boshlanadi. Tugatish: tugmani qayta bosing yoki Esc.
              </div>
            )}

            <div className="flex gap-1.5 pt-1">
              <button
                onClick={undoLastWaypoint}
                disabled={waypoints.length === 0}
                className="flex-1 py-1.5 px-2 bg-tactical-900 hover:bg-tactical-800 disabled:opacity-40 border border-tactical-700 text-slate-300 rounded font-mono text-xs flex items-center justify-center gap-1 transition-all"
              >
                <Undo2 className="w-3 h-3 text-amber-400" />
                Oxirgisini o'chirish
              </button>
            </div>

            <div className="flex gap-1.5">
              <button
                onClick={clearWaypoints}
                className="flex-1 py-1.5 px-2 bg-tactical-900 hover:bg-tactical-800 border border-tactical-700 text-slate-300 rounded font-mono text-xs flex items-center justify-center gap-1 transition-all"
              >
                <Trash2 className="w-3 h-3 text-rose-400" />
                Tozalash
              </button>
              <button
                onClick={centerMap}
                className="flex-1 py-1.5 px-2 bg-tactical-900 hover:bg-tactical-800 border border-tactical-700 text-slate-300 rounded font-mono text-xs flex items-center justify-center gap-1 transition-all"
              >
                <Crosshair className="w-3 h-3 text-police-cyan" />
                Markazga
              </button>
            </div>
          </div>
        )}

        {/* REAL RASPBERRY PI CONTROLS */}
        {mode === 'real' && (
          <div className="bg-tactical-950/90 border border-tactical-800/80 backdrop-blur-md rounded-xl p-3 shadow-xl flex flex-col gap-2">
            <div className="text-[10px] font-mono font-bold text-police-cyan uppercase tracking-wider flex items-center justify-between">
              <span>Raspberry Pi 4 Jonli Aloqasi</span>
              <span className={`text-[10px] font-bold ${isConnectedPi ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isConnectedPi ? 'ONLINE' : isConnectingPi ? 'ULANMOQDA...' : 'OFFLINE'}
              </span>
            </div>

            <label className="text-[10px] font-mono text-slate-400">Robot IP manzili (WebSocket /ws):</label>
            <input
              type="text"
              value={robotIp}
              onChange={e => setRobotIp(e.target.value)}
              className="bg-tactical-900 border border-tactical-700 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-police-cyan"
              placeholder="192.168.1.100:8000"
            />

            <button
              onClick={togglePiConnection}
              className={`py-2 px-3 rounded font-mono text-xs font-bold flex items-center justify-center gap-1.5 shadow transition-all ${
                isConnectedPi
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-police-blue hover:bg-blue-600 text-white'
              }`}
            >
              {isConnectedPi ? (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  Ulanishni Uzish (Disconnect)
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  🔌 Ulanish (Connect)
                </>
              )}
            </button>
          </div>
        )}

        {/* JONLI TELEMETRIYA */}
        <div className="bg-tactical-950/90 border border-tactical-800/80 backdrop-blur-md rounded-xl p-3 shadow-xl flex flex-col gap-2">
          <div className="text-[10px] font-mono font-bold text-police-cyan uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Radio className="w-3 h-3 text-police-cyan animate-pulse" />
              Jonli GPS &amp; Sensor Telemetriyasi
            </span>
          </div>

                    <div className="bg-tactical-900/90 border border-tactical-700/60 p-1.5 rounded flex items-center justify-between text-xs font-mono mb-1">
            <div className="flex items-center space-x-1.5">
              <span className={`w-2 h-2 rounded-full ${gps.isReal ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`}></span>
              <span className="text-[10px] text-slate-300">
                {gps.isReal ? 'Haqiqiy Qurilma GPS' : 'Simulyatsiya GPS'}
              </span>
            </div>
            <button
              onClick={gps.isReal ? toggleGPSMode : startRealGPS}
              className="text-[10px] px-2 py-0.5 rounded bg-police-blue/30 text-police-cyan border border-police-cyan/50 hover:bg-police-blue/60"
            >
              {gps.isReal ? 'Real GPS Faol' : 'Real GPS Yoqish'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="bg-tactical-900/90 border-l-2 border-police-blue p-2 rounded">
              <div className="text-[10px] text-slate-400">GPS Kenglik (Lat)</div>
              <div className="font-bold text-slate-100">{telemetry.lat.toFixed(6)}° N</div>
            </div>

            <div className="bg-tactical-900/90 border-l-2 border-police-blue p-2 rounded">
              <div className="text-[10px] text-slate-400">GPS Uzunlik (Lon)</div>
              <div className="font-bold text-slate-100">{telemetry.lon.toFixed(6)}° E</div>
            </div>

            <div className="bg-tactical-900/90 border-l-2 border-amber-500 p-2 rounded">
              <div className="text-[10px] text-slate-400 flex items-center gap-1">
                <Compass className="w-3 h-3" /> Kompas (Heading)
              </div>
              <div className="font-bold text-amber-400">{Math.round(telemetry.heading)}°</div>
            </div>

            <div className="bg-tactical-900/90 border-l-2 border-emerald-500 p-2 rounded">
              <div className="text-[10px] text-slate-400">Patrul Tezligi</div>
              <div className="font-bold text-emerald-400">
                {telemetry.speed.toFixed(1)} m/s ({(telemetry.speed * 3.6).toFixed(1)} km/h)
              </div>
            </div>

            <div className="bg-tactical-900/90 border-l-2 border-cyan-500 p-2 rounded">
              <div className="text-[10px] text-slate-400 flex items-center gap-1">
                <Cpu className="w-3 h-3" /> 360° LiDAR Skan
              </div>
              <div className="font-bold text-cyan-400">Faol ({telemetry.lidarHz} Hz)</div>
            </div>

            <div className="bg-tactical-900/90 border-l-2 border-indigo-500 p-2 rounded">
              <div className="text-[10px] text-slate-400 flex items-center gap-1">
                <Battery className="w-3 h-3" /> Batareya (LiFePO4)
              </div>
              <div className="font-bold text-indigo-300">
                {telemetry.batteryVoltage}V ({telemetry.batteryPercent}%)
              </div>
            </div>
          </div>
        </div>

        {/* INSTRUCTIONS */}
        <div className="bg-tactical-950/80 border-l-2 border-police-cyan rounded p-2 text-[10px] font-sans text-slate-400 leading-relaxed shadow-lg">
          <p className="font-semibold text-police-cyan mb-0.5">💡 Qo'llanma:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><b>Demo rejimida:</b> "Marshrut chizish" tugmasini bosib, xaritada nuqtalarni ketma-ket bosing; robot aynan shu chiziq bo'ylab yuradi va oxiriga yetgach orqaga qaytadi.</li>
            <li><b>Real rejimda:</b> Raspberry Pi IP sini kiriting va planshetning aniq GPS koordinatasini jonli kuzating.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default GoogleMapsPatrolView;
