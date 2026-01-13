/**
 * VRP (Vehicle Routing Problem) Optimizer with Time Windows
 *
 * This service optimizes routes considering:
 * - Travel time between stops (via Google Distance Matrix API)
 * - Time windows for each stop
 * - Service time at each stop
 * - Driver start/end times
 */

interface Location {
  id: string;
  lat: number;
  lng: number;
  timeWindowStart?: Date | null; // Earliest arrival time
  timeWindowEnd?: Date | null;   // Latest arrival time
  serviceMinutes: number;        // Time spent at stop
  priority: number;              // Higher = more important
}

interface OptimizationInput {
  depot: { lat: number; lng: number };
  stops: Location[];
  driverStartTime: Date;  // When driver starts (e.g., 8:00 AM)
  driverEndTime: Date;    // When driver must finish (e.g., 6:00 PM)
  apiKey: string;
}

interface OptimizedStop {
  id: string;
  order: number;
  estimatedArrival: Date;
  estimatedDeparture: Date;
  waitTime: number;          // Minutes waiting for time window to open
  lateBy: number;            // Minutes late (0 if on time)
  canMakeTimeWindow: boolean;
  travelTimeFromPrevious: number; // Minutes
}

interface OptimizationResult {
  success: boolean;
  optimizedStops: OptimizedStop[];
  totalDistance: number;      // In meters
  totalDuration: number;      // In minutes
  totalWaitTime: number;      // Minutes waiting for time windows
  unserviceableStops: string[]; // IDs of stops that can't be reached in time
  warnings: string[];
}

interface DistanceMatrixResponse {
  status: string;
  rows: Array<{
    elements: Array<{
      status: string;
      duration: { value: number };
      distance: { value: number };
    }>;
  }>;
}

// Haversine formula - calcula distancia en metros entre dos puntos
function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Radio de la Tierra en metros
  const toRad = (deg: number) => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distancia en metros
}

// Genera matriz de distancias usando Haversine (GRATIS - sin API)
function getDistanceMatrixHaversine(
  locations: { lat: number; lng: number }[]
): { durations: number[][]; distances: number[][] } {
  const n = locations.length;
  const distances: number[][] = [];
  const durations: number[][] = [];

  // Factor de corrección: las calles no son línea recta
  // En zonas urbanas típicas, la distancia real es ~1.3-1.4x la línea recta
  const ROAD_FACTOR = 1.35;
  // Velocidad promedio en ciudad: 30 km/h = 500 m/min
  const AVG_SPEED_M_PER_MIN = 500;

  for (let i = 0; i < n; i++) {
    distances[i] = [];
    durations[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        distances[i][j] = 0;
        durations[i][j] = 0;
      } else {
        const dist = haversineDistance(
          locations[i].lat, locations[i].lng,
          locations[j].lat, locations[j].lng
        ) * ROAD_FACTOR;

        distances[i][j] = dist;
        durations[i][j] = Math.ceil(dist / AVG_SPEED_M_PER_MIN);
      }
    }
  }

  return { distances, durations };
}

// Obtener tiempos reales con UNA sola llamada a Google Directions API
// Costo: ~$0.005 por llamada (vs $2+ con Distance Matrix para muchas paradas)
async function getRealTimesFromDirections(
  depot: { lat: number; lng: number },
  stops: { lat: number; lng: number }[],
  apiKey: string,
  returnToDepot: boolean = true
): Promise<{ legDurations: number[]; legDistances: number[]; totalDuration: number; totalDistance: number; returnLegDuration: number; returnLegDistance: number } | null> {
  try {
    if (stops.length === 0) return null;

    // Construir waypoints (paradas intermedias)
    const waypoints = stops.map(s => `${s.lat},${s.lng}`).join('|');

    // Origen y destino
    const origin = `${depot.lat},${depot.lng}`;
    const destination = returnToDepot ? origin : `${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}`;

    // Si returnToDepot es false, los waypoints son todas las paradas excepto la última
    const waypointsParam = returnToDepot
      ? waypoints
      : stops.slice(0, -1).map(s => `${s.lat},${s.lng}`).join('|');

    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    if (waypointsParam) {
      url.searchParams.set('waypoints', waypointsParam);
    }
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('key', apiKey);

    console.log(`[HYBRID] Fetching real times from Directions API (1 call)`);

    const response = await fetch(url.toString());
    const data = await response.json() as any;

    if (data.status !== 'OK') {
      console.warn(`[HYBRID] Directions API error: ${data.status}`);
      return null;
    }

    const route = data.routes[0];
    const legs = route.legs;

    // Extraer duraciones y distancias de cada tramo
    const legDurations: number[] = [];
    const legDistances: number[] = [];
    let totalDuration = 0;
    let totalDistance = 0;
    let returnLegDuration = 0;
    let returnLegDistance = 0;

    // legs[0] = depot -> stop1
    // legs[1] = stop1 -> stop2
    // ...
    // legs[n] = stopN -> depot (si returnToDepot)
    // Con returnToDepot=true y N paradas: legs.length = N+1

    console.log(`[HYBRID] Processing ${legs.length} legs for ${stops.length} stops, returnToDepot=${returnToDepot}`);

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const durationMin = Math.ceil(leg.duration.value / 60);
      const distanceM = leg.distance.value;

      totalDuration += durationMin;
      totalDistance += distanceM;

      // El último tramo es el retorno al depot
      if (returnToDepot && i === legs.length - 1) {
        returnLegDuration = durationMin;
        returnLegDistance = distanceM;
        console.log(`[HYBRID] Return leg (${i}): ${durationMin}min, ${distanceM}m`);
      } else {
        // Tramos hacia las paradas
        legDurations.push(durationMin);
        legDistances.push(distanceM);
      }
    }

    console.log(`[HYBRID] Real times obtained: ${(totalDistance / 1000).toFixed(2)}km, ${totalDuration}min, return: ${returnLegDuration}min`);

    return { legDurations, legDistances, totalDuration, totalDistance, returnLegDuration, returnLegDistance };
  } catch (error) {
    console.warn('[HYBRID] Error fetching real times:', error);
    return null;
  }
}

// Get distance matrix from Google API
async function getDistanceMatrix(
  origins: { lat: number; lng: number }[],
  destinations: { lat: number; lng: number }[],
  apiKey: string
): Promise<{ durations: number[][]; distances: number[][] }> {
  const originStr = origins.map(o => `${o.lat},${o.lng}`).join('|');
  const destStr = destinations.map(d => `${d.lat},${d.lng}`).join('|');

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originStr}&destinations=${destStr}&mode=driving&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json() as DistanceMatrixResponse;

  if (data.status !== 'OK') {
    throw new Error(`Distance Matrix API error: ${data.status}`);
  }

  const durations: number[][] = [];
  const distances: number[][] = [];

  for (const row of data.rows) {
    const durationRow: number[] = [];
    const distanceRow: number[] = [];

    for (const element of row.elements) {
      if (element.status === 'OK') {
        durationRow.push(Math.ceil(element.duration.value / 60)); // Convert to minutes
        distanceRow.push(element.distance.value); // In meters
      } else {
        durationRow.push(Infinity);
        distanceRow.push(Infinity);
      }
    }

    durations.push(durationRow);
    distances.push(distanceRow);
  }

  return { durations, distances };
}

// Parse time window from Date to minutes from midnight
function getMinutesFromMidnight(date: Date | null | undefined): number | null {
  if (!date) return null;
  const d = new Date(date);
  return d.getHours() * 60 + d.getMinutes();
}

// Create Date from minutes and base date
function minutesToDate(minutes: number, baseDate: Date): Date {
  const result = new Date(baseDate);
  result.setHours(0, 0, 0, 0);
  result.setMinutes(minutes);
  return result;
}

/**
 * Time-Window Aware Nearest Neighbor Algorithm
 *
 * This is a greedy algorithm that at each step selects the next stop based on:
 * 1. Whether it can be reached within its time window
 * 2. Travel time + potential wait time
 * 3. Priority of the stop
 */
export async function optimizeRouteWithTimeWindows(
  input: OptimizationInput
): Promise<OptimizationResult> {
  const { depot, stops, driverStartTime, driverEndTime, apiKey } = input;

  if (stops.length === 0) {
    return {
      success: true,
      optimizedStops: [],
      totalDistance: 0,
      totalDuration: 0,
      totalWaitTime: 0,
      unserviceableStops: [],
      warnings: []
    };
  }

  if (stops.length === 1) {
    // Single stop - no optimization needed, just calculate times
    const stop = stops[0];
    const matrix = await getDistanceMatrix([depot], [{ lat: stop.lat, lng: stop.lng }], apiKey);
    const travelTime = matrix.durations[0][0];
    const arrival = new Date(driverStartTime.getTime() + travelTime * 60000);

    return {
      success: true,
      optimizedStops: [{
        id: stop.id,
        order: 1,
        estimatedArrival: arrival,
        estimatedDeparture: new Date(arrival.getTime() + stop.serviceMinutes * 60000),
        waitTime: 0,
        lateBy: 0,
        canMakeTimeWindow: true,
        travelTimeFromPrevious: travelTime
      }],
      totalDistance: matrix.distances[0][0],
      totalDuration: travelTime + stop.serviceMinutes,
      totalWaitTime: 0,
      unserviceableStops: [],
      warnings: []
    };
  }

  // Build all locations array (depot + all stops)
  const allLocations = [depot, ...stops.map(s => ({ lat: s.lat, lng: s.lng }))];

  // Get full distance matrix
  console.log(`Fetching distance matrix for ${allLocations.length} locations...`);
  const matrix = await getDistanceMatrix(allLocations, allLocations, apiKey);

  // Initialize
  const driverStartMinutes = driverStartTime.getHours() * 60 + driverStartTime.getMinutes();
  const driverEndMinutes = driverEndTime.getHours() * 60 + driverEndTime.getMinutes();
  const baseDate = new Date(driverStartTime);
  baseDate.setHours(0, 0, 0, 0);

  const unvisited = new Set(stops.map((_, i) => i + 1)); // Indices in matrix (0 is depot)
  const optimizedOrder: number[] = [];
  const optimizedStops: OptimizedStop[] = [];
  const unserviceableStops: string[] = [];
  const warnings: string[] = [];

  let currentPosition = 0; // Start at depot
  let currentTime = driverStartMinutes; // Current time in minutes from midnight
  let totalDistance = 0;
  let totalWaitTime = 0;

  // Greedy nearest neighbor with time window awareness
  while (unvisited.size > 0) {
    let bestNext = -1;
    let bestScore = Infinity;
    let bestArrivalTime = 0;
    let bestWaitTime = 0;
    let bestTravelTime = 0;

    for (const stopIdx of unvisited) {
      const stop = stops[stopIdx - 1]; // -1 because index 0 is depot
      const travelTime = matrix.durations[currentPosition][stopIdx];

      if (travelTime === Infinity) continue;

      const arrivalTime = currentTime + travelTime;
      const windowStart = getMinutesFromMidnight(stop.timeWindowStart);
      const windowEnd = getMinutesFromMidnight(stop.timeWindowEnd);

      // Calculate wait time if arriving before window opens
      let waitTime = 0;
      let actualServiceStart = arrivalTime;

      if (windowStart !== null && arrivalTime < windowStart) {
        waitTime = windowStart - arrivalTime;
        actualServiceStart = windowStart;
      }

      // Check if we can make the time window
      let canMakeWindow = true;
      let lateBy = 0;

      if (windowEnd !== null && actualServiceStart > windowEnd) {
        canMakeWindow = false;
        lateBy = actualServiceStart - windowEnd;
      }

      // Check if we'll exceed driver end time
      const departureTime = actualServiceStart + stop.serviceMinutes;
      if (departureTime > driverEndMinutes) {
        // This stop would make us finish too late
        // We could still consider it with a penalty
      }

      // Calculate score (lower is better)
      // Score considers: travel time, wait time, whether time window is met, priority
      let score = travelTime + waitTime * 0.5; // Wait time is less penalized than travel

      // Heavy penalty for missing time window
      if (!canMakeWindow) {
        score += lateBy * 10;
      }

      // Strong bonus for high priority stops (priority 1 = -20, priority 2 = -40)
      // This makes priority significantly impact the ordering
      score -= stop.priority * 20;

      // Prefer stops with earlier time windows (they're more urgent)
      if (windowEnd !== null) {
        const urgency = Math.max(0, windowEnd - currentTime);
        if (urgency < 60) { // Less than 1 hour left to reach
          score -= 20; // Prioritize urgent stops
        }
      }

      // Additional urgency bonus for high priority stops earlier in the route
      // This ensures priority stops are visited sooner, not just considered
      if (stop.priority > 0 && optimizedOrder.length < 3) {
        score -= stop.priority * 15; // Extra bonus for early placement
      }

      if (score < bestScore) {
        bestScore = score;
        bestNext = stopIdx;
        bestArrivalTime = arrivalTime;
        bestWaitTime = waitTime;
        bestTravelTime = travelTime;
      }
    }

    if (bestNext === -1) {
      // No reachable stops - shouldn't happen normally
      warnings.push('No se pudieron alcanzar algunas paradas');
      for (const stopIdx of unvisited) {
        unserviceableStops.push(stops[stopIdx - 1].id);
      }
      break;
    }

    // Add the best stop to our route
    const stop = stops[bestNext - 1];
    const windowStart = getMinutesFromMidnight(stop.timeWindowStart);
    const windowEnd = getMinutesFromMidnight(stop.timeWindowEnd);

    let actualServiceStart = bestArrivalTime;
    if (windowStart !== null && bestArrivalTime < windowStart) {
      actualServiceStart = windowStart;
    }

    const canMakeWindow = windowEnd === null || actualServiceStart <= windowEnd;
    const lateBy = !canMakeWindow && windowEnd !== null ? actualServiceStart - windowEnd : 0;

    if (!canMakeWindow) {
      warnings.push(`Parada ${stop.id} llegará ${lateBy} minutos tarde`);
    }

    optimizedOrder.push(bestNext);
    optimizedStops.push({
      id: stop.id,
      order: optimizedOrder.length,
      estimatedArrival: minutesToDate(bestArrivalTime, baseDate),
      estimatedDeparture: minutesToDate(actualServiceStart + stop.serviceMinutes, baseDate),
      waitTime: bestWaitTime,
      lateBy: lateBy,
      canMakeTimeWindow: canMakeWindow,
      travelTimeFromPrevious: bestTravelTime
    });

    totalDistance += matrix.distances[currentPosition][bestNext];
    totalWaitTime += bestWaitTime;

    // Update state
    currentPosition = bestNext;
    currentTime = actualServiceStart + stop.serviceMinutes;
    unvisited.delete(bestNext);
  }

  // Calculate total duration
  const totalDuration = currentTime - driverStartMinutes;

  return {
    success: true,
    optimizedStops,
    totalDistance,
    totalDuration,
    totalWaitTime,
    unserviceableStops,
    warnings
  };
}

/**
 * Google Directions API response interfaces
 */
interface DirectionsResponse {
  status: string;
  routes: Array<{
    waypoint_order: number[];
    legs: Array<{
      distance: { value: number };
      duration: { value: number };
      duration_in_traffic?: { value: number };
    }>;
  }>;
}

/**
 * Optimización usando Google Directions API con optimizeWaypoints
 *
 * Esta es la mejor opción cuando NO hay ventanas de tiempo porque:
 * - Google usa algoritmos avanzados de optimización
 * - Considera tráfico en tiempo real (con departure_time)
 * - Conoce bloqueos de calles, obras, condiciones actuales
 * - Es más económico (1 llamada vs matrix completa)
 */
interface DirectionsOptimizationResult {
  order: string[];
  totalDistance: number;
  totalDuration: number;
  legDistances: number[];
  legDurations: number[];
  usedTraffic: boolean;
  estimatedArrivals: { id: string; arrival: Date; departure: Date }[];
  depotReturnTime?: Date;  // Hora estimada de llegada al depot (retorno)
  returnLegDuration?: number;  // Minutos de viaje desde última parada al depot
}

export async function optimizeRouteWithDirections(
  depot: { lat: number; lng: number },
  stops: { id: string; lat: number; lng: number; serviceMinutes?: number }[],
  apiKey: string,
  departureTime?: Date,
  defaultServiceMinutes: number = 15
): Promise<DirectionsOptimizationResult> {
  const startTime = departureTime || new Date();

  if (stops.length === 0) {
    return {
      order: [],
      totalDistance: 0,
      totalDuration: 0,
      legDistances: [],
      legDurations: [],
      usedTraffic: false,
      estimatedArrivals: []
    };
  }

  if (stops.length === 1) {
    // Single stop - just get directions without optimization
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${depot.lat},${depot.lng}`);
    url.searchParams.set('destination', `${stops[0].lat},${stops[0].lng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json() as DirectionsResponse;

    if (data.status !== 'OK' || !data.routes[0]) {
      throw new Error(`Directions API error: ${data.status}`);
    }

    const leg = data.routes[0].legs[0];
    const durationMin = Math.ceil(leg.duration.value / 60);
    const serviceMin = stops[0].serviceMinutes || defaultServiceMinutes;
    const arrivalTime = new Date(startTime.getTime() + durationMin * 60000);
    const departureFromStop = new Date(arrivalTime.getTime() + serviceMin * 60000);

    return {
      order: [stops[0].id],
      totalDistance: leg.distance.value,
      totalDuration: durationMin,
      legDistances: [leg.distance.value],
      legDurations: [durationMin],
      usedTraffic: false,
      estimatedArrivals: [{
        id: stops[0].id,
        arrival: arrivalTime,
        departure: departureFromStop
      }]
    };
  }

  // Build waypoints string (all stops as intermediate waypoints)
  // Circular route: depot -> optimized stops -> depot
  const waypointsStr = stops.map(s => `${s.lat},${s.lng}`).join('|');

  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${depot.lat},${depot.lng}`);
  url.searchParams.set('destination', `${depot.lat},${depot.lng}`); // Return to depot (circular)
  url.searchParams.set('waypoints', `optimize:true|${waypointsStr}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', apiKey);

  // Add departure_time for traffic consideration (must be in the future or "now")
  let usedTraffic = false;
  if (departureTime) {
    const depTime = new Date(departureTime);
    const now = new Date();
    if (depTime > now) {
      url.searchParams.set('departure_time', Math.floor(depTime.getTime() / 1000).toString());
      usedTraffic = true;
    } else {
      url.searchParams.set('departure_time', 'now');
      usedTraffic = true;
    }
  }

  console.log(`Calling Directions API with ${stops.length} waypoints, traffic: ${usedTraffic}`);

  const response = await fetch(url.toString());
  const data = await response.json() as DirectionsResponse;

  if (data.status !== 'OK') {
    throw new Error(`Directions API error: ${data.status}`);
  }

  if (!data.routes[0]) {
    throw new Error('No route found');
  }

  const route = data.routes[0];
  const waypointOrder = route.waypoint_order;

  // Reorder stops based on Google's optimization
  const optimizedOrder = waypointOrder.map(i => stops[i].id);
  const optimizedStops = waypointOrder.map(i => stops[i]);

  // Calculate totals from legs and estimated arrivals
  let totalDistance = 0;
  let totalDuration = 0;
  const legDistances: number[] = [];
  const legDurations: number[] = [];
  const estimatedArrivals: { id: string; arrival: Date; departure: Date }[] = [];

  let currentTime = startTime.getTime();

  // legs[0..n-1] are the delivery legs, legs[n] is return to depot (excluded from stops)
  for (let i = 0; i < route.legs.length - 1; i++) {
    const leg = route.legs[i];
    const distance = leg.distance.value;
    const durationSeconds = leg.duration_in_traffic?.value || leg.duration.value;
    const durationMin = Math.ceil(durationSeconds / 60);

    totalDistance += distance;
    totalDuration += durationSeconds;
    legDistances.push(distance);
    legDurations.push(durationMin);

    // Calculate arrival time for this stop
    currentTime += durationSeconds * 1000; // Add travel time
    const arrivalTime = new Date(currentTime);

    // Get service time for this stop
    const stopData = optimizedStops[i];
    const serviceMin = stopData?.serviceMinutes || defaultServiceMinutes;

    // Calculate departure time (after service)
    const departureTime = new Date(currentTime + serviceMin * 60000);
    currentTime = departureTime.getTime(); // Update current time to departure

    estimatedArrivals.push({
      id: optimizedOrder[i],
      arrival: arrivalTime,
      departure: departureTime
    });
  }

  return {
    order: optimizedOrder,
    totalDistance,
    totalDuration: Math.ceil(totalDuration / 60), // Convert to minutes
    legDistances,
    legDurations,
    usedTraffic,
    estimatedArrivals
  };
}

/**
 * Simple optimization without time windows (just distance)
 * Falls back to this if Directions API fails
 * @deprecated Use optimizeRouteWithDirections instead
 */
export async function optimizeRouteByDistance(
  depot: { lat: number; lng: number },
  stops: { id: string; lat: number; lng: number }[],
  apiKey: string
): Promise<{ order: string[]; totalDistance: number; totalDuration: number }> {
  if (stops.length <= 1) {
    return {
      order: stops.map(s => s.id),
      totalDistance: 0,
      totalDuration: 0
    };
  }

  const allLocations = [depot, ...stops];
  const matrix = await getDistanceMatrix(allLocations, allLocations, apiKey);

  // Simple nearest neighbor
  const unvisited = new Set(stops.map((_, i) => i + 1));
  const order: string[] = [];
  let current = 0;
  let totalDistance = 0;
  let totalDuration = 0;

  while (unvisited.size > 0) {
    let nearest = -1;
    let nearestDist = Infinity;

    for (const idx of unvisited) {
      const dist = matrix.distances[current][idx];
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = idx;
      }
    }

    if (nearest === -1) break;

    order.push(stops[nearest - 1].id);
    totalDistance += matrix.distances[current][nearest];
    totalDuration += matrix.durations[current][nearest];
    current = nearest;
    unvisited.delete(nearest);
  }

  return { order, totalDistance, totalDuration };
}

/**
 * Simulated Annealing Algorithm for TSP Optimization
 *
 * A metaheuristic that finds near-optimal solutions by:
 * 1. Starting with an initial solution
 * 2. Making random changes (swaps, reversals)
 * 3. Accepting worse solutions with decreasing probability (to escape local optima)
 * 4. Gradually "cooling down" to converge on a good solution
 *
 * This produces much better results than greedy algorithms like nearest neighbor.
 */

// Calculate total route distance using distance matrix
function calculateRouteDistance(
  route: number[],  // Array of indices (0 = depot)
  distances: number[][]
): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += distances[route[i]][route[i + 1]];
  }
  return total;
}

// Swap two positions in the route (excluding depot at start/end)
function swapPositions(route: number[], i: number, j: number): number[] {
  const newRoute = [...route];
  [newRoute[i], newRoute[j]] = [newRoute[j], newRoute[i]];
  return newRoute;
}

// Reverse a segment of the route (2-opt move)
function reverseSegment(route: number[], i: number, j: number): number[] {
  return [
    ...route.slice(0, i),
    ...route.slice(i, j + 1).reverse(),
    ...route.slice(j + 1)
  ];
}

// Generate a neighbor solution using random move
function generateNeighbor(route: number[]): number[] {
  const n = route.length;
  // Only modify positions 1 to n-2 (keep depot at start and end)
  const i = 1 + Math.floor(Math.random() * (n - 3));
  const j = i + 1 + Math.floor(Math.random() * (n - 2 - i));

  // Randomly choose between swap and reverse
  if (Math.random() < 0.5) {
    return swapPositions(route, i, j);
  } else {
    return reverseSegment(route, i, j);
  }
}

// Simulated Annealing optimization
function simulatedAnnealing(
  initialRoute: number[],
  distances: number[][],
  options: {
    initialTemp?: number;
    coolingRate?: number;
    minTemp?: number;
    iterationsPerTemp?: number;
  } = {}
): number[] {
  const {
    initialTemp = 10000,
    coolingRate = 0.995,
    minTemp = 1,
    iterationsPerTemp = 100
  } = options;

  let currentRoute = [...initialRoute];
  let currentDistance = calculateRouteDistance(currentRoute, distances);
  let bestRoute = [...currentRoute];
  let bestDistance = currentDistance;
  let temperature = initialTemp;
  let totalIterations = 0;

  console.log(`[SA] Starting Simulated Annealing - Initial distance: ${(currentDistance / 1000).toFixed(2)} km`);

  while (temperature > minTemp) {
    for (let i = 0; i < iterationsPerTemp; i++) {
      totalIterations++;

      // Generate a neighbor solution
      const neighborRoute = generateNeighbor(currentRoute);
      const neighborDistance = calculateRouteDistance(neighborRoute, distances);

      // Calculate the difference in distance
      const delta = neighborDistance - currentDistance;

      // Accept the neighbor if it's better, or with probability based on temperature
      if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
        currentRoute = neighborRoute;
        currentDistance = neighborDistance;

        // Update best if this is the best we've seen
        if (currentDistance < bestDistance) {
          bestRoute = [...currentRoute];
          bestDistance = currentDistance;
        }
      }
    }

    // Cool down
    temperature *= coolingRate;
  }

  const improvement = ((1 - bestDistance / calculateRouteDistance(initialRoute, distances)) * 100).toFixed(1);
  console.log(`[SA] Completed in ${totalIterations} iterations`);
  console.log(`[SA] Best distance: ${(bestDistance / 1000).toFixed(2)} km (${improvement}% improvement)`);

  return bestRoute;
}

// Apply 2-opt improvement as a final polish
function apply2Opt(
  route: number[],
  distances: number[][]
): number[] {
  let improved = true;
  let bestRoute = [...route];
  let bestDistance = calculateRouteDistance(bestRoute, distances);
  let iterations = 0;
  const maxIterations = 1000;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 1; i < bestRoute.length - 2; i++) {
      for (let j = i + 1; j < bestRoute.length - 1; j++) {
        const newRoute = reverseSegment(bestRoute, i, j);
        const newDistance = calculateRouteDistance(newRoute, distances);

        if (newDistance < bestDistance) {
          bestRoute = newRoute;
          bestDistance = newDistance;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  console.log(`[2-OPT] Final polish: ${iterations} iterations`);
  return bestRoute;
}

/**
 * Optimización completa con Simulated Annealing + 2-opt
 *
 * 1. Obtiene matriz de distancias
 * 2. Genera ruta inicial con Nearest Neighbor
 * 3. Optimiza con Simulated Annealing (encuentra solución global)
 * 4. Pule con 2-opt (mejora local final)
 * 5. Calcula tiempos estimados de llegada
 */
export async function optimizeRouteWith2Opt(
  depot: { lat: number; lng: number },
  stops: { id: string; lat: number; lng: number; serviceMinutes?: number }[],
  apiKey: string,
  departureTime?: Date,
  defaultServiceMinutes: number = 15,
  returnToDepot?: { lat: number; lng: number },  // Punto de retorno real (diferente si hay primera parada forzada)
  useHaversine: boolean = false  // true = gratis (Haversine), false = Google Matrix API
): Promise<DirectionsOptimizationResult> {
  const startTime = departureTime || new Date();

  if (stops.length === 0) {
    return {
      order: [],
      totalDistance: 0,
      totalDuration: 0,
      legDistances: [],
      legDurations: [],
      usedTraffic: false,
      estimatedArrivals: []
    };
  }

  if (stops.length === 1) {
    // Single stop - just get distance
    const singleLocations = [depot, { lat: stops[0].lat, lng: stops[0].lng }];
    const matrix = useHaversine
      ? getDistanceMatrixHaversine(singleLocations)
      : await getDistanceMatrix(singleLocations, singleLocations, apiKey);
    const durationMin = matrix.durations[0][1];
    const distanceM = matrix.distances[0][1];
    const serviceMin = stops[0].serviceMinutes || defaultServiceMinutes;
    const arrivalTime = new Date(startTime.getTime() + durationMin * 60000);
    const departureFromStop = new Date(arrivalTime.getTime() + serviceMin * 60000);

    return {
      order: [stops[0].id],
      totalDistance: distanceM,
      totalDuration: durationMin,
      legDistances: [distanceM],
      legDurations: [durationMin],
      usedTraffic: false,
      estimatedArrivals: [{
        id: stops[0].id,
        arrival: arrivalTime,
        departure: departureFromStop
      }]
    };
  }

  // Determinar si hay un punto de retorno diferente al origen
  const hasReturnPoint = returnToDepot &&
    (returnToDepot.lat !== depot.lat || returnToDepot.lng !== depot.lng);

  const matrixMode = useHaversine ? 'Haversine (GRATIS)' : 'Google Matrix API';
  console.log(`[OPTIMIZE] Starting optimization for ${stops.length} stops using Simulated Annealing`);
  console.log(`[OPTIMIZE] Distance matrix mode: ${matrixMode}`);
  if (hasReturnPoint) {
    console.log(`[OPTIMIZE] Different return point specified (forced first stop scenario)`);
  }

  // Get full distance matrix (depot + all stops + return point if different)
  const allLocations = hasReturnPoint
    ? [depot, ...stops.map(s => ({ lat: s.lat, lng: s.lng })), returnToDepot]
    : [depot, ...stops.map(s => ({ lat: s.lat, lng: s.lng }))];

  // Elegir método de cálculo de distancias
  const matrix = useHaversine
    ? getDistanceMatrixHaversine(allLocations)
    : await getDistanceMatrix(allLocations, allLocations, apiKey);

  // Índice del punto de retorno (último índice si hay punto diferente, 0 si es el mismo depot)
  const returnIdx = hasReturnPoint ? allLocations.length - 1 : 0;

  // Step 1: Generate initial route using Nearest Neighbor
  const unvisited = new Set(stops.map((_, i) => i + 1)); // 1 to N (0 is depot/origin)
  const initialRoute: number[] = [0]; // Start at depot/origin
  let current = 0;

  while (unvisited.size > 0) {
    let nearest = -1;
    let nearestDist = Infinity;

    for (const idx of unvisited) {
      const dist = matrix.distances[current][idx];
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = idx;
      }
    }

    if (nearest === -1) break;
    initialRoute.push(nearest);
    current = nearest;
    unvisited.delete(nearest);
  }

  initialRoute.push(returnIdx); // Return to real depot (may be different from origin)

  const initialDistance = calculateRouteDistance(initialRoute, matrix.distances);
  console.log(`[OPTIMIZE] Initial route distance (Nearest Neighbor): ${(initialDistance / 1000).toFixed(2)} km`);

  // Step 2: Apply Simulated Annealing for global optimization
  const saRoute = simulatedAnnealing(initialRoute, matrix.distances, {
    initialTemp: 10000,
    coolingRate: 0.995,
    minTemp: 0.1,
    iterationsPerTemp: 50 * stops.length // More iterations for more stops
  });

  // Step 3: Apply 2-opt for final polish
  const optimizedRoute = apply2Opt(saRoute, matrix.distances);
  const optimizedDistance = calculateRouteDistance(optimizedRoute, matrix.distances);

  const totalImprovement = ((1 - optimizedDistance / initialDistance) * 100).toFixed(1);
  console.log(`[OPTIMIZE] Final route distance: ${(optimizedDistance / 1000).toFixed(2)} km (${totalImprovement}% total improvement)`);

  // Step 4: Build result
  // Remove depot from start and end to get just stop indices
  const stopIndices = optimizedRoute.slice(1, -1); // Remove first and last (depot)
  const optimizedOrder = stopIndices.map(i => stops[i - 1].id);
  const optimizedStops = stopIndices.map(i => stops[i - 1]);

  // Si usamos Haversine, obtener tiempos reales con UNA llamada a Google Directions
  // Esto da tiempos precisos por solo ~$0.005 en vez de ~$2+ con Distance Matrix
  let realTimes: { legDurations: number[]; legDistances: number[]; totalDuration: number; totalDistance: number; returnLegDuration: number; returnLegDistance: number } | null = null;

  if (useHaversine && optimizedStops.length > 0) {
    console.log(`[HYBRID] Haversine optimization done, fetching real times...`);
    realTimes = await getRealTimesFromDirections(
      depot,
      optimizedStops.map(s => ({ lat: s.lat, lng: s.lng })),
      apiKey,
      true // return to depot
    );
  }

  // Calculate leg distances, durations, and arrival times
  const legDistances: number[] = [];
  const legDurations: number[] = [];
  const estimatedArrivals: { id: string; arrival: Date; departure: Date }[] = [];

  let totalDistance = 0;
  let totalDuration = 0;
  let currentTime = startTime.getTime();
  let prevIdx = 0; // Start from depot

  for (let i = 0; i < stopIndices.length; i++) {
    const stopIdx = stopIndices[i];

    // Usar tiempos reales si están disponibles, sino usar los de la matriz
    const distance = realTimes ? realTimes.legDistances[i] : matrix.distances[prevIdx][stopIdx];
    const durationMin = realTimes ? realTimes.legDurations[i] : matrix.durations[prevIdx][stopIdx];

    totalDistance += distance;
    totalDuration += durationMin;
    legDistances.push(distance);
    legDurations.push(durationMin);

    // Calculate arrival time
    currentTime += durationMin * 60000;
    const arrivalTime = new Date(currentTime);

    // Get service time
    const stopData = optimizedStops[i];
    const serviceMin = stopData?.serviceMinutes || defaultServiceMinutes;

    // Calculate departure time
    const departureFromStop = new Date(currentTime + serviceMin * 60000);
    currentTime = departureFromStop.getTime();

    estimatedArrivals.push({
      id: optimizedOrder[i],
      arrival: arrivalTime,
      departure: departureFromStop
    });

    prevIdx = stopIdx;
  }

  // Calcular hora de retorno al depot
  let depotReturnTime: Date | undefined;
  let returnLegDuration: number | undefined;

  if (realTimes && realTimes.returnLegDuration > 0) {
    returnLegDuration = realTimes.returnLegDuration;
    // currentTime ya tiene la hora de salida de la última parada
    depotReturnTime = new Date(currentTime + returnLegDuration * 60000);
    console.log(`[HYBRID] Using real times: ${(totalDistance / 1000).toFixed(2)} km, ${totalDuration} min`);
    console.log(`[HYBRID] Depot return: ${returnLegDuration} min, arrival at ${depotReturnTime.toISOString()}`);
  } else {
    // Estimar retorno usando la matriz (Haversine o Google)
    const lastStopIdx = stopIndices[stopIndices.length - 1];
    const returnIdx = hasReturnPoint ? allLocations.length - 1 : 0;
    returnLegDuration = Math.ceil(matrix.durations[lastStopIdx][returnIdx]);
    depotReturnTime = new Date(currentTime + returnLegDuration * 60000);
    console.log(`[OPTIMIZE] Depot return (estimated): ${returnLegDuration} min`);
  }

  return {
    order: optimizedOrder,
    totalDistance,
    totalDuration,
    legDistances,
    legDurations,
    usedTraffic: false,
    estimatedArrivals,
    depotReturnTime,
    returnLegDuration
  };
}
