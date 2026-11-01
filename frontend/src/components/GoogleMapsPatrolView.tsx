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
  MapPin,
  Sparkles,
  Radio
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
  const { system } = useRobot();

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

  // Calculate street route with OSRM (avoid houses and barriers)
  const calculateRoute = useCallback(async (pts: Waypoint[]) => {
    if (!mapRef.current) return;

    if (pts.length < 2) {
      detailedNodesRef.current = pts.map(p => [p.lat, p.lon]);
      renderPolyline(detailedNodesRef.current);
      setRoutingStatus(pts.length === 1 ? "Yana kamida 1 ta nuqta qo'ying" : "Nuqtalar qo'yilmagan");
      return;
    }

    setRoutingStatus("⏳ Ko'chalar hisoblanmoqda (uylar chetlab o'tilmoqda)...");

    // Loop back to start
    const loopPts = [...pts, pts[0]];
    const coordPairs = loopPts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${coordPairs}?overview=full&geometries=geojson`;

    try {
      const response = await fetch(osrmUrl);
      const data = await response.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const coords: [number, number][] = data.routes[0].geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]]
        );
        detailedNodesRef.current = coords;
        currentPathIndexRef.current = 0;
        renderPolyline(coords);
        setRoutingStatus(`✅ Ko'chaga bog'landi (${coords.length} ta aniq burilish)`);
        return;
      }
    } catch {
      // Fallback
    }

    // Grid fallback
    const fallback: [number, number][] = [];
    for (let i = 0; i < loopPts.length - 1; i++) {
      const p1 = loopPts[i];
      const p2 = loopPts[i + 1];
      fallback.push([p1.lat, p1.lon]);
      fallback.push([p1.lat, p2.lon]);
    }
    fallback.push([loopPts[loopPts.length - 1].lat, loopPts[loopPts.length - 1].lon]);
    detailedNodesRef.current = fallback;
    currentPathIndexRef.current = 0;
    renderPolyline(fallback);
    setRoutingStatus(`🛡️ Zaxira ko'cha marshruti (${fallback.length} nuqta)`);
  }, [renderPolyline]);

  // Add a waypoint
  const addWaypoint = useCallback((lat: number, lon: number) => {
    if (!mapRef.current) return;

    setWaypoints(prev => {
      const updated = [...prev, { lat, lon }];
      const idx = updated.length;

      const marker = L.circleMarker([lat, lon], {
        radius: 6,
        fillColor: '#00e5ff',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.95
      }).addTo(mapRef.current!).bindPopup(`<b>Waypoint ${idx}</b><br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}`);

      waypointMarkersRef.current.push(marker);
      calculateRoute(updated);
      return updated;
    });
  }, [calculateRoute]);

  // Clear waypoints
  const clearWaypoints = useCallback(() => {
    if (patrolIntervalRef.current) {
      clearInterval(patrolIntervalRef.current);
      patrolIntervalRef.current = null;
    }
    setIsPatrolling(false);
    setWaypoints([]);
    detailedNodesRef.current = [];
    currentPathIndexRef.current = 0;

    if (mapRef.current) {
      waypointMarkersRef.current.forEach(m => mapRef.current?.removeLayer(m));
      waypointMarkersRef.current = [];
      if (polylineRef.current) {
        mapRef.current.removeLayer(polylineRef.current);
        polylineRef.current = null;
      }
    }
    setRoutingStatus("Tozalandi. Xaritada nuqta tanlang.");
    setTelemetry(prev => ({ ...prev, speed: 0 }));
  }, []);

  // Preset 1: G'alaba & Amir Temur
  const loadGalabaAmirTemurPreset = useCallback(() => {
    clearWaypoints();
    if (!mapRef.current) return;

    mapRef.current.setView([40.099325, 65.379185], 18);

    const points: Waypoint[] = [
      { lat: 40.10185, lon: 65.37480 },
      { lat: 40.09935, lon: 65.37890 },
      { lat: 40.09680, lon: 65.38020 },
      { lat: 40.09695, lon: 65.38060 },
      { lat: 40.09950, lon: 65.37920 },
      { lat: 40.10170, lon: 65.37510 },
    ];

    points.forEach((pt, i) => {
      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius: 6,
        fillColor: '#00e5ff',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.95
      }).addTo(mapRef.current!).bindPopup(`<b>Waypoint ${i + 1}</b> (G'alaba)<br>Lat: ${pt.lat.toFixed(6)}<br>Lon: ${pt.lon.toFixed(6)}`);
      waypointMarkersRef.current.push(marker);
    });

    setWaypoints(points);
    calculateRoute(points);

    setTelemetry(prev => ({
      ...prev,
      lat: 40.099325,
      lon: 65.379185,
      heading: 135,
      speed: 0
    }));
    setRobotVisual(40.099325, 65.379185, 135);
  }, [clearWaypoints, calculateRoute, setRobotVisual]);

  // Preset 2: Navoiy ko'chasi
  const loadNavoiyStreetPreset = useCallback(() => {
    clearWaypoints();
    if (!mapRef.current) return;

    mapRef.current.setView(NAVOI_CENTER, 19);

    const points: Waypoint[] = [
      { lat: 40.10080, lon: 65.36765 },
      { lat: 40.09975, lon: 65.36845 },
      { lat: 40.09915, lon: 65.36890 },
      { lat: 40.09930, lon: 65.36915 },
      { lat: 40.10010, lon: 65.36855 },
    ];

    points.forEach((pt, i) => {
      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius: 6,
        fillColor: '#00e5ff',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.95
      }).addTo(mapRef.current!).bindPopup(`<b>Waypoint ${i + 1}</b> (Navoiy k.)<br>Lat: ${pt.lat.toFixed(6)}<br>Lon: ${pt.lon.toFixed(6)}`);
      waypointMarkersRef.current.push(marker);
    });

    setWaypoints(points);
    calculateRoute(points);

    setTelemetry(prev => ({
      ...prev,
      lat: NAVOI_CENTER[0],
      lon: NAVOI_CENTER[1],
      heading: 150,
      speed: 0
    }));
    setRobotVisual(NAVOI_CENTER[0], NAVOI_CENTER[1], 150);
  }, [clearWaypoints, calculateRoute, setRobotVisual]);

  // Start Demo Patrol Simulation Loop
  const startPatrol = useCallback(() => {
    if (detailedNodesRef.current.length === 0) {
      alert("Iltimos, avval xaritada ko'cha nuqtalarini qo'ying yoki tayyor ko'cha tugmalaridan birini bosing!");
      return;
    }

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
          currentPathIndexRef.current = (currentPathIndexRef.current + 1) % nodes.length;
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
  }, [setRobotVisual]);

  const stopPatrol = useCallback(() => {
    setIsPatrolling(false);
    if (patrolIntervalRef.current) {
      clearInterval(patrolIntervalRef.current);
      patrolIntervalRef.current = null;
    }
    setTelemetry(prev => ({ ...prev, speed: 0 }));
  }, []);

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

    // Handle map clicks in demo mode
    map.on('click', (e: L.LeafletMouseEvent) => {
      addWaypoint(e.latlng.lat, e.latlng.lng);
    });

    // Invalidate size to guarantee full container rendering
    setTimeout(() => {
      map.invalidateSize();
      loadGalabaAmirTemurPreset();
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
      <div className="absolute right-3 top-14 bottom-3 w-84 z-20 flex flex-col gap-2.5 overflow-y-auto pr-1 pointer-events-auto">
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
            <div className="flex flex-col gap-1.5 pt-1">
              <button
                onClick={loadGalabaAmirTemurPreset}
                className="w-full py-1.5 px-2 bg-tactical-900 hover:bg-police-blue/30 border border-police-blue/40 text-slate-200 hover:text-white rounded font-mono text-[11px] flex items-center gap-1.5 transition-all text-left truncate"
              >
                <MapPin className="w-3.5 h-3.5 text-police-cyan shrink-0" />
                <span>1. G'alaba &amp; Amir Temur (Markaz)</span>
              </button>
              <button
                onClick={loadNavoiyStreetPreset}
                className="w-full py-1.5 px-2 bg-tactical-900 hover:bg-police-blue/30 border border-police-blue/40 text-slate-200 hover:text-white rounded font-mono text-[11px] flex items-center gap-1.5 transition-all text-left truncate"
              >
                <MapPin className="w-3.5 h-3.5 text-police-cyan shrink-0" />
                <span>2. Navoiy ko'chasi (Qizilqum 13)</span>
              </button>
            </div>

            <div className="flex gap-1.5 pt-1">
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
            <li><b>Demo rejimida:</b> Xarita ustiga bosing — robot Google Maps ko'chalari bo'ylab avtonom harakatlanadi.</li>
            <li><b>Real rejimda:</b> Raspberry Pi IP sini kiriting va planshetning aniq GPS koordinatasini jonli kuzating.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default GoogleMapsPatrolView;
