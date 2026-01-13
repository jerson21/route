import { env } from '../config/env.js';

interface GeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  success: boolean;
  error?: string;
}

interface GoogleGeocodeResponse {
  results: Array<{
    formatted_address: string;
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
  }>;
  status: string;
  error_message?: string;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return {
      latitude: 0,
      longitude: 0,
      formattedAddress: address,
      success: false,
      error: 'Google Maps API key no configurada'
    };
  }

  try {
    const encodedAddress = encodeURIComponent(address);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${env.GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json() as GoogleGeocodeResponse;

    if (data.status === 'OK' && data.results.length > 0) {
      const result = data.results[0];
      return {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        formattedAddress: result.formatted_address,
        success: true
      };
    }

    return {
      latitude: 0,
      longitude: 0,
      formattedAddress: address,
      success: false,
      error: data.error_message || `Geocoding failed: ${data.status}`
    };
  } catch (error) {
    return {
      latitude: 0,
      longitude: 0,
      formattedAddress: address,
      success: false,
      error: error instanceof Error ? error.message : 'Error de geocodificación'
    };
  }
}

export async function geocodeAddresses(addresses: string[]): Promise<GeocodeResult[]> {
  const results: GeocodeResult[] = [];

  for (const address of addresses) {
    const result = await geocodeAddress(address);
    results.push(result);
    // Rate limiting: esperar 100ms entre llamadas
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}
