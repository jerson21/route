/**
 * Script para simular movimiento del conductor
 * Uso: node scripts/simulate-driver.js <routeId> [token]
 *
 * El script obtiene las paradas de la ruta y simula el conductor
 * moviéndose entre ellas.
 */

const routeId = process.argv[2];
const token = process.argv[3] || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImRyaXZlci0xIiwicm9sZSI6IkRSSVZFUiIsImlhdCI6MTcwMDAwMDAwMH0.fake';

if (!routeId) {
  console.log('Uso: node scripts/simulate-driver.js <routeId> [token]');
  console.log('\nPara obtener un token, inicia sesión en la app y copia el token del localStorage.');
  console.log('O usa el endpoint POST /api/v1/auth/login');
  process.exit(1);
}

const API_URL = process.env.API_URL || 'http://localhost:3001/api/v1';

async function getRoute() {
  const res = await fetch(`${API_URL}/routes/${routeId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Error obteniendo ruta');
  }
  return (await res.json()).data;
}

async function updateLocation(lat, lng, heading, speed) {
  const res = await fetch(`${API_URL}/routes/${routeId}/location`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ latitude: lat, longitude: lng, heading, speed })
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Error actualizando ubicación');
  }
  return (await res.json()).data;
}

function calculateHeading(from, to) {
  const dLon = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let heading = Math.atan2(y, x) * 180 / Math.PI;
  return (heading + 360) % 360;
}

function interpolate(from, to, t) {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t
  };
}

async function simulateMovement() {
  console.log(`\n🚚 Simulador de Conductor`);
  console.log(`📍 Ruta: ${routeId}`);
  console.log(`🌐 API: ${API_URL}\n`);

  try {
    const route = await getRoute();
    console.log(`✅ Ruta encontrada: ${route.name}`);
    console.log(`   Estado: ${route.status}`);
    console.log(`   Paradas: ${route.stops.length}\n`);

    if (route.status !== 'IN_PROGRESS') {
      console.log('⚠️  La ruta debe estar en estado IN_PROGRESS para simular.');
      console.log('   Inicia la ruta desde la interfaz web primero.');
      process.exit(1);
    }

    // Construir lista de puntos: depot -> paradas -> depot
    const points = [];

    if (route.depot) {
      points.push({ lat: route.depot.latitude, lng: route.depot.longitude, name: `Depot: ${route.depot.name}` });
    }

    for (const stop of route.stops) {
      if (stop.address.latitude && stop.address.longitude) {
        points.push({
          lat: stop.address.latitude,
          lng: stop.address.longitude,
          name: `Parada ${stop.sequenceOrder}: ${stop.address.customerName || stop.address.fullAddress.substring(0, 30)}`
        });
      }
    }

    if (route.depot) {
      points.push({ lat: route.depot.latitude, lng: route.depot.longitude, name: 'Retorno al Depot' });
    }

    if (points.length < 2) {
      console.log('❌ No hay suficientes puntos con coordenadas para simular.');
      process.exit(1);
    }

    console.log('📍 Ruta de simulación:');
    points.forEach((p, i) => console.log(`   ${i + 1}. ${p.name}`));
    console.log('\n🚀 Iniciando simulación... (Ctrl+C para detener)\n');

    const STEPS_BETWEEN_POINTS = 10; // Pasos entre cada punto
    const STEP_DELAY_MS = 2000; // 2 segundos entre actualizaciones

    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      const heading = calculateHeading(from, to);

      console.log(`\n➡️  Viajando de "${from.name}" a "${to.name}"`);

      for (let step = 0; step <= STEPS_BETWEEN_POINTS; step++) {
        const t = step / STEPS_BETWEEN_POINTS;
        const pos = interpolate(from, to, t);
        const speed = step === 0 || step === STEPS_BETWEEN_POINTS ? 0 : 30 + Math.random() * 20; // 30-50 km/h

        try {
          await updateLocation(pos.lat, pos.lng, heading, speed);
          const progress = Math.round(t * 100);
          process.stdout.write(`\r   📍 Progreso: ${progress}% | Lat: ${pos.lat.toFixed(6)} | Lng: ${pos.lng.toFixed(6)} | Vel: ${speed.toFixed(0)} km/h`);
        } catch (err) {
          console.error(`\n❌ Error: ${err.message}`);
        }

        await new Promise(r => setTimeout(r, STEP_DELAY_MS));
      }

      console.log(`\n   ✅ Llegó a "${to.name}"`);

      // Pausa en cada parada
      if (i < points.length - 2) {
        console.log('   ⏳ Esperando 5 segundos en parada...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    console.log('\n\n🎉 Simulación completada!');

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

simulateMovement();
