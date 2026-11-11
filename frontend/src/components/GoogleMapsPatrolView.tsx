import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { autopilotService, type AutopilotState } from '../services/autopilotService';
import {
  Layers,
  Square,
  Trash2,
  Crosshair,
  Navigation,
  Compass,
  Radio,
  PenLine,
  Check,
  Undo2
} from 'lucide-react';
import { useRobot } from '../context/RobotContext';
import { headingService, SmoothAngle, type HeadingMode, type HeadingSource } from '../services/headingService';
import { navigationService, type NavState } from '../services/navigationService';
import { camLinkSettings } from '../services/camLinkSettings';
import { fleetWatcher, selectedRobotStore, type FleetState } from '../services/robotCamLink';

// Default center: Navoiy street (Opposite Qizilqum 13 & Navoiy City)
const NAVOI_CENTER: [number, number] = [40.09985, 65.36835];

// High-fidelity SVG Digital Twin Robot
const ROBOT_SVG_CONTENT = `
  <div id="react-robot-marker-svg" style="width: 56px; height: 58px; transform: rotate(0deg); transform-origin: 28px 29px; will-change: transform; filter: drop-shadow(0 0 8px rgba(0, 229, 255, 0.6));">
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
  const { gps, startRealGPS } = useRobot();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const robotMarkerRef = useRef<L.Marker | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const waypointMarkersRef = useRef<L.CircleMarker[]>([]);

  const [mapLayerType, setMapLayerType] = useState<'hybrid' | 'roadmap'>('hybrid');
  const [routingStatus, setRoutingStatus] = useState<string>("Nuqtalar qo'yilmagan");

  // Panel raqamlari: navigatsiya holatidan (GPS + giroskop)
  const [telemetry, setTelemetry] = useState({
    lat: NAVOI_CENTER[0],
    lon: NAVOI_CENTER[1],
    heading: 0,
    speed: 0
  });

  // Waypoints & Path
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const detailedNodesRef = useRef<[number, number][]>([]);

  // Tile layer references
  const hybridLayerRef = useRef<L.TileLayer | null>(null);
  const roadmapLayerRef = useRef<L.TileLayer | null>(null);

  // ---------------------------------------------------------------------------
  // ROBOT MARKERI: joylashuv darhol, burilish esa giroskop (IMU / planshet sensori) bo'yicha silliq.
  // setRobotVisual dagi heading faqat zaxira (giroskop ma'lumoti bo'lmasa: GPS yo'nalishi).
  // ---------------------------------------------------------------------------
  const fallbackHeadingRef = useRef(135);
  const headingVectorRef = useRef<L.Polyline | null>(null);
  const [headingInfo, setHeadingInfo] = useState<{ heading: number; source: HeadingSource; rate: number }>({
    heading: 135,
    source: 'none',
    rate: 0
  });
  const [headingMode, setHeadingModeState] = useState<HeadingMode>(() => headingService.getMode());
  const changeHeadingMode = useCallback(async (m: HeadingMode) => {
    if (m === 'device' || m === 'auto') await headingService.requestDevicePermission();
    headingService.setMode(m);
    setHeadingModeState(m);
  }, []);

  const setRobotVisual = useCallback((lat: number, lon: number, heading: number) => {
    if (robotMarkerRef.current) {
      robotMarkerRef.current.setLatLng([lat, lon]);
    }
    fallbackHeadingRef.current = heading;
  }, []);

  // Har kadrda: maqsad burchak (giroskop yoki zaxira) -> silliq o'ralmagan burchak -> marker va yo'nalish vektori
  useEffect(() => {
    const unsub = headingService.subscribe(() => {});
    const smooth = new SmoothAngle(120);
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      // Operatorda yo'nalish robot telemetriyasidan keladi (operator telefoni/planshetining sensori emas)
      const gyro = remoteHeadingRef.current ? null : headingService.getState();
      const target = gyro ? gyro.heading : fallbackHeadingRef.current;
      const shown = smooth.step(target, dt);

      const svgElem = document.getElementById('react-robot-marker-svg');
      if (svgElem) svgElem.style.transform = `rotate(${shown.toFixed(2)}deg)`;

      // Harakat yo'nalishi vektori: robotdan oldinga ~14 m, ko'rsatilgan burchak bo'yicha
      const map = mapRef.current;
      const marker = robotMarkerRef.current;
      if (map && marker) {
        const p = marker.getLatLng();
        const rad = (shown * Math.PI) / 180;
        const meters = 14;
        const dLat = (meters * Math.cos(rad)) / 111320;
        const dLon = (meters * Math.sin(rad)) / (111320 * Math.cos((p.lat * Math.PI) / 180));
        const tip: L.LatLngExpression = [p.lat + dLat, p.lng + dLon];
        if (!headingVectorRef.current) {
          headingVectorRef.current = L.polyline([p, tip], {
            color: gyro ? '#facc15' : '#00e5ff',
            weight: 3,
            opacity: 0.9,
            dashArray: '6 6',
            interactive: false
          }).addTo(map);
        } else {
          headingVectorRef.current.setLatLngs([p, tip]);
          headingVectorRef.current.setStyle({ color: gyro ? '#facc15' : '#00e5ff' });
        }
      }

      // Panel raqamlari 5 marta/s yangilanadi (har kadrda React qayta chizilmasin)
      if (now - lastUi > 200) {
        lastUi = now;
        const h = ((shown % 360) + 360) % 360;
        setHeadingInfo((prev) => {
          const next = { heading: Math.round(h), source: gyro?.source ?? 'none', rate: Math.round(gyro?.rate ?? 0) };
          return prev.heading === next.heading && prev.source === next.source && prev.rate === next.rate ? prev : next;
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      headingVectorRef.current?.remove();
      headingVectorRef.current = null;
    };
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
    if (autopilotService.getState().active) autopilotService.stop('Marshrut o‘chirildi');
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

  // MARKAZIY NAVIGATSIYA: joylashuv + tezlik + yo'nalish bitta holatdan (GPS uzilsa dead reckoning).
  const [nav, setNav] = useState<NavState | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  // Operator qurilmasi: marker tanlangan ROBOT telemetriyasidan (o'z GPS/giroskopi emas)
  const [isOperator, setIsOperator] = useState(() => camLinkSettings.get().role === 'operator');
  useEffect(() => camLinkSettings.subscribe((s) => setIsOperator(s.role === 'operator')), []);
  const remoteHeadingRef = useRef(false);
  remoteHeadingRef.current = isOperator;

  /** Bitta navigatsiya holatini xaritaga chizish (mahalliy yoki robotdan kelgan) */
  const lastNavUiRef = useRef(0);
  const applyNav = useCallback(
    (s: NavState) => {
      setRobotVisual(s.lat, s.lon, s.heading);
      const map = mapRef.current;
      if (map) {
        const r = Math.min(500, Math.max(2, s.accuracy));
        const color = s.positionSource === 'gps' ? '#22c55e' : s.positionSource === 'dead-reckoning' ? '#f59e0b' : '#ef4444';
        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = L.circle([s.lat, s.lon], { radius: r, color, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
        } else {
          accuracyCircleRef.current.setLatLng([s.lat, s.lon]).setRadius(r).setStyle({ color });
        }
      }
      // Panel 4 marta/s yangilanadi
      const now = Date.now();
      if (now - lastNavUiRef.current > 250) {
        lastNavUiRef.current = now;
        setNav(s);
        setTelemetry((prev) => ({ ...prev, lat: s.lat, lon: s.lon, speed: s.speed, heading: s.heading }));
      }
    },
    [setRobotVisual]
  );

  useEffect(() => {
    if (isOperator) return;
    return navigationService.subscribe((s) => {
      if (!s.initialized) return;
      applyNav(s);
    });
  }, [isOperator, applyNav]);

  // OPERATOR: park telemetriyasi. Tanlangan robot asosiy marker, qolganlari kichik belgilar (bosilsa tanlanadi)
  const [fleet, setFleet] = useState<FleetState>(() => fleetWatcher.getState());
  const [chosenRobot, setChosenRobot] = useState(() => selectedRobotStore.get());
  useEffect(() => fleetWatcher.subscribe(setFleet), []);
  useEffect(() => selectedRobotStore.subscribe(setChosenRobot), []);
  const watchedRobot =
    (chosenRobot && fleet.robots.some((r) => r.id === chosenRobot) ? chosenRobot : '') ||
    fleet.robots.find((r) => r.online)?.id ||
    '';
  const otherRobotMarkersRef = useRef(new Map<string, L.CircleMarker>());
  useEffect(() => {
    if (!isOperator) return;
    const map = mapRef.current;
    const seen = new Set<string>();
    for (const r of fleet.robots) {
      const n = r.tel?.nav;
      if (!n) continue;
      if (r.id === watchedRobot) {
        applyNav({
          lat: n.lat,
          lon: n.lon,
          speed: n.speed,
          heading: n.heading,
          headingSource: n.hsrc,
          positionSource: r.online ? n.psrc : 'stale',
          accuracy: n.acc,
          gpsAgeMs: n.gpsAgeS < 0 ? Infinity : n.gpsAgeS * 1000,
          t: r.tel!.t,
          initialized: true
        });
        continue;
      }
      if (!map) continue;
      seen.add(r.id);
      let m = otherRobotMarkersRef.current.get(r.id);
      if (!m) {
        m = L.circleMarker([n.lat, n.lon], { radius: 8, weight: 2, fillOpacity: 0.7 })
          .bindTooltip(r.id, { permanent: true, direction: 'top', offset: [0, -8] })
          .on('click', () => selectedRobotStore.set(r.id))
          .addTo(map);
        otherRobotMarkersRef.current.set(r.id, m);
      }
      m.setLatLng([n.lat, n.lon]).setStyle({ color: r.online ? '#38bdf8' : '#64748b', fillColor: r.online ? '#0ea5e9' : '#334155' });
    }
    otherRobotMarkersRef.current.forEach((m, id) => {
      if (!seen.has(id)) {
        m.remove();
        otherRobotMarkersRef.current.delete(id);
      }
    });
  }, [isOperator, fleet, watchedRobot, applyNav]);
  useEffect(() => {
    const markers = otherRobotMarkersRef.current;
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
    };
  }, []);
  useEffect(
    () => () => {
      accuracyCircleRef.current?.remove();
      accuracyCircleRef.current = null;
    },
    []
  );

  const goToRealGPS = useCallback(() => {
    if (!mapRef.current) return;
    startRealGPS();
    mapRef.current.setView([gps.latitude, gps.longitude], 19);
    setRobotVisual(gps.latitude, gps.longitude, gps.heading || fallbackHeadingRef.current);
    setTelemetry(prev => ({
      ...prev,
      lat: gps.latitude,
      lon: gps.longitude,
      speed: gps.speed || 0,
      heading: gps.heading || prev.heading
    }));
  }, [gps, startRealGPS, setRobotVisual]);

  // HAQIQIY GPS AVTOPILOT (ESP32): chizilgan marshrut bo'ylab robotni haqiqatan yurgizadi
  const [ap, setAp] = useState<AutopilotState>(() => autopilotService.getState());
  useEffect(() => autopilotService.subscribe(setAp), []);
  const startAutopilot = useCallback(() => {
    if (waypointsRef.current.length < 1) {
      setRoutingStatus("Avval \"Marshrut chizish\" bilan manzil (kamida 1 nuqta) belgilang.");
      return;
    }
    if (drawModeRef.current) setDrawing(false);
    autopilotService.start(waypointsRef.current);
  }, [setDrawing]);

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

    // Avtopilot yurayotgan bo'lsa (xarita qayta ochildi), uning marshrutini xaritaga qaytarish
    if (autopilotService.getState().active && waypointsRef.current.length === 0) {
      autopilotService.getRoute().forEach((p) => addWaypoint(p.lat, p.lon));
    }

    // Invalidate size to guarantee full container rendering (test marshruti endi avtomatik yuklanmaydi)
    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
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
            <span className={`w-2.5 h-2.5 rounded-full ${gps.isReal ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]' : 'bg-amber-400 shadow-[0_0_8px_#f59e0b]'}`} />
            <span className="text-[11px] font-mono font-bold text-slate-300">
              {gps.isReal ? 'HAQIQIY GPS' : 'GPS QIDIRILMOQDA'}
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
        {/* MARSHRUT VA HAQIQIY GPS AVTOPILOT */}
        <div className="bg-tactical-950/90 border border-emerald-500/50 backdrop-blur-md rounded-xl p-3 shadow-xl flex flex-col gap-2">
          <div className="text-[10px] font-mono font-bold text-emerald-300 uppercase tracking-wider flex items-center justify-between">
            <span>Marshrut va avtopilot</span>
            <span className="text-police-cyan">{waypoints.length} ta nuqta</span>
          </div>
          <div className="text-emerald-400 text-[10px] font-mono font-bold truncate">{routingStatus}</div>
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
            {/* OPERATOR: tanlangan robotni masofadan manzilga yuborish (avtopilot robot planshetida ishlaydi) */}
            {isOperator && (() => {
              const robot = fleet.robots.find((r) => r.id === watchedRobot);
              const rap = robot?.tel?.ap;
              const fresh = !!robot?.online;
              return (
                <div className="border border-emerald-500/40 bg-emerald-950/30 rounded-lg p-2 flex flex-col gap-1.5">
                  <div className="text-[10px] font-mono font-bold text-emerald-300 uppercase tracking-wider flex items-center justify-between">
                    <span>GPS Avtopilot · {watchedRobot || 'robot yo‘q'}</span>
                    <span className={rap?.on ? 'text-emerald-400' : rap?.ph === 'arrived' ? 'text-sky-300' : rap?.ph === 'failed' ? 'text-rose-400' : 'text-slate-400'}>
                      {!fresh ? 'OFFLAYN' : rap?.on ? `YURMOQDA · ${rap.cmd}` : rap?.ph === 'arrived' ? 'YETDI' : rap?.ph === 'failed' ? "TO'XTADI" : "O'CHIQ"}
                    </span>
                  </div>
                  {rap && (
                    <div className={`text-[10px] font-mono font-bold ${rap.ph === 'obstacle-stop' || rap.ph === 'failed' ? 'text-rose-300' : rap.ph.startsWith('waiting') ? 'text-amber-300' : 'text-emerald-200'}`}>
                      {rap.msg}
                    </div>
                  )}
                  {rap?.on && (
                    <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-slate-300">
                      <span>Nuqta: {rap.i + 1}/{rap.n}</span>
                      <span>Qoldi: {rap.d < 1000 ? `${rap.d} m` : `${(rap.d / 1000).toFixed(2)} km`}</span>
                      <span>Xato: {rap.err}°</span>
                    </div>
                  )}
                  {rap?.on ? (
                    <button
                      onClick={() => void fleetWatcher.sendAutopilot(watchedRobot, { op: 'stop' })}
                      className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded font-mono text-sm font-black flex items-center justify-center gap-1.5 shadow"
                    >
                      <Square className="w-4 h-4 fill-white" />
                      AVTOPILOTNI TO'XTATISH
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        if (drawModeRef.current) setDrawing(false);
                        const ok = await fleetWatcher.sendAutopilot(watchedRobot, { op: 'start', route: waypointsRef.current.map((p) => ({ lat: p.lat, lon: p.lon })) });
                        setRoutingStatus(ok ? `📡 Marshrut ${watchedRobot} robotiga yuborildi` : "Robotga ulanib bo'lmadi (park aloqasi yo'q)");
                      }}
                      disabled={waypoints.length < 1 || !fresh}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-mono text-xs font-bold flex items-center justify-center gap-1.5 shadow"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      Robotni manzilga yuborish
                    </button>
                  )}
                  <div className="text-[9px] font-mono text-slate-400 leading-snug">
                    {!fresh
                      ? 'Robot planshet onlayn emas: unda Qalqon ochiq va "Robot" rolida bo\'lishi kerak.'
                      : waypoints.length < 1
                      ? "Avval \"Marshrut chizish\" bilan manzil nuqtasini qo'ying."
                      : 'Robot planshet o\'z GPS + giroskopi bo\'yicha ESP32 ga buyruq beradi, to\'siqni kamerasi bilan aniqlaydi (planshetda istalgan bo\'lim ochiq bo\'lishi mumkin).'}
                  </div>
                </div>
              );
            })()}

            {/* HAQIQIY GPS AVTOPILOT */}
            {!isOperator && (
              <div className="border border-emerald-500/40 bg-emerald-950/30 rounded-lg p-2 flex flex-col gap-1.5">
                <div className="text-[10px] font-mono font-bold text-emerald-300 uppercase tracking-wider flex items-center justify-between">
                  <span>GPS Avtopilot (ESP32)</span>
                  <span className={ap.active ? 'text-emerald-400' : ap.phase === 'arrived' ? 'text-sky-300' : ap.phase === 'failed' ? 'text-rose-400' : 'text-slate-400'}>
                    {ap.active ? `YURMOQDA · ${ap.command}` : ap.phase === 'arrived' ? 'YETDI' : ap.phase === 'failed' ? "TO'XTADI" : "O'CHIQ"}
                  </span>
                </div>
                <div className={`text-[10px] font-mono font-bold ${ap.phase === 'obstacle-stop' || ap.phase === 'failed' ? 'text-rose-300' : ap.phase.startsWith('waiting') ? 'text-amber-300' : 'text-emerald-200'}`}>
                  {ap.message}
                </div>
                {ap.active && (
                  <div className="grid grid-cols-3 gap-1 text-[10px] font-mono text-slate-300">
                    <span>Nuqta: {ap.targetIndex + 1}/{ap.total}</span>
                    <span>Qoldi: {ap.distanceToEndM < 1000 ? `${Math.round(ap.distanceToEndM)} m` : `${(ap.distanceToEndM / 1000).toFixed(2)} km`}</span>
                    <span>Xato: {ap.bearingErrorDeg}°</span>
                  </div>
                )}
                {ap.active ? (
                  <button
                    onClick={() => autopilotService.stop('Operator to‘xtatdi')}
                    className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded font-mono text-sm font-black flex items-center justify-center gap-1.5 shadow"
                  >
                    <Square className="w-4 h-4 fill-white" />
                    AVTOPILOTNI TO'XTATISH
                  </button>
                ) : (
                  <button
                    onClick={startAutopilot}
                    disabled={waypoints.length < 1}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-mono text-xs font-bold flex items-center justify-center gap-1.5 shadow"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    Manzilga haqiqiy yurish
                  </button>
                )}
                <div className="text-[9px] font-mono text-slate-400 leading-snug">
                  Planshet GPS + giroskop bo'yicha ESP32'ga buyruq beradi. To'siq bo'lsa to'xtaydi va chetlab o'tadi. Kamera to'siq tahlili istalgan bo'limda fonda ishlaydi. Joystik yoki klaviatura avtopilotni darhol o'chiradi.
                </div>
              </div>
            )}
        </div>

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
                {gps.isReal ? 'Qurilma GPS i faol' : gps.status === 'SEARCHING' ? 'GPS qidirilmoqda…' : gps.error || "GPS yo'q"}
              </span>
            </div>
            <button
              onClick={startRealGPS}
              className="text-[10px] px-2 py-0.5 rounded bg-police-blue/30 text-police-cyan border border-police-cyan/50 hover:bg-police-blue/60"
            >
              Qayta ulash
            </button>
          </div>

          {/* Markaziy navigatsiya holati: joylashuv manbai va aniqligi */}
          {nav && (
            <div
              data-nav-status
              className={`mb-2 px-2 py-1.5 rounded border text-[11px] font-mono flex items-center justify-between gap-2 ${
                nav.positionSource === 'gps'
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : nav.positionSource === 'dead-reckoning'
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                  : 'bg-rose-500/10 border-rose-500/40 text-rose-300'
              }`}
            >
              <span className="font-bold">
                {nav.positionSource === 'gps'
                  ? 'GPS + giroskop'
                  : nav.positionSource === 'dead-reckoning'
                  ? `GPS yo'q ${Math.round(nav.gpsAgeMs / 1000)} s: hisoblangan`
                  : "GPS uzoq vaqt yo'q: joylashuv eskirgan"}
              </span>
              <span>±{nav.accuracy < 1000 ? Math.round(nav.accuracy) : '>999'} m</span>
            </div>
          )}
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
                <Compass className="w-3 h-3" /> Giroskop (Heading)
              </div>
              <div className="font-bold text-amber-400 flex items-baseline gap-1.5" data-heading-value>
                {headingInfo.heading}°
                {headingInfo.source !== 'none' && Math.abs(headingInfo.rate) >= 2 && (
                  <span className="text-[10px] font-normal text-slate-400">
                    {headingInfo.rate > 0 ? '↻' : '↺'} {Math.abs(headingInfo.rate)}°/s
                  </span>
                )}
              </div>
              <div className="text-[9px] text-slate-500" data-heading-source>
                {headingInfo.source === 'imu'
                  ? 'Manba: robot IMU'
                  : headingInfo.source === 'device'
                  ? 'Manba: planshet giroskopi'
                  : headingInfo.source === 'gps'
                  ? "Manba: GPS yo'nalishi"
                  : headingMode === 'off'
                  ? "Giroskop o'chiq"
                  : "Giroskop signali yo'q"}
              </div>
              <select
                value={headingMode}
                onChange={(e) => void changeHeadingMode(e.target.value as HeadingMode)}
                title="Marker yo'nalishi manbai"
                className="mt-1 w-full bg-tactical-950 border border-tactical-700 rounded text-[10px] text-slate-200 px-1 py-0.5"
              >
                <option value="auto">Avto (IMU → planshet → GPS)</option>
                <option value="imu">Faqat robot IMU</option>
                <option value="device">Faqat planshet giroskopi</option>
                <option value="gps">Faqat GPS</option>
                <option value="off">O'chiq</option>
              </select>
            </div>

            <div className="bg-tactical-900/90 border-l-2 border-emerald-500 p-2 rounded">
              <div className="text-[10px] text-slate-400">Patrul Tezligi</div>
              <div className="font-bold text-emerald-400">
                {telemetry.speed.toFixed(1)} m/s ({(telemetry.speed * 3.6).toFixed(1)} km/h)
              </div>
            </div>

          </div>
        </div>

        {/* INSTRUCTIONS */}
        <div className="bg-tactical-950/80 border-l-2 border-police-cyan rounded p-2 text-[10px] font-sans text-slate-400 leading-relaxed shadow-lg">
          <p className="font-semibold text-police-cyan mb-0.5">💡 Qo'llanma:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>"Marshrut chizish" tugmasini bosib, xaritada nuqtalarni ketma-ket bosing, so'ng "Chizishni tugatish".</li>
            <li>Robot planshetida "Manzilga haqiqiy yurish", operatorda "Robotni manzilga yuborish": robot GPS + giroskop bo'yicha ESP32 orqali yuradi, to'siqni kamera bilan aylanib o'tadi.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default GoogleMapsPatrolView;
