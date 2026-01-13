import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, MapPin, Loader2 } from 'lucide-react';

interface PlaceResult {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
}

interface AddressSearchProps {
  apiKey: string;
  onSelect: (place: PlaceResult) => void;
  placeholder?: string;
  minChars?: number;
  debounceMs?: number;
}

export function AddressSearch({
  apiKey,
  onSelect,
  placeholder = 'Buscar dirección...',
  minChars = 4,
  debounceMs = 500
}: AddressSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cargar Google Maps script
  useEffect(() => {
    if (!apiKey) return;

    // Verificar si ya está cargado
    if (window.google?.maps?.places) {
      setIsScriptLoaded(true);
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => setIsScriptLoaded(true));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => setIsScriptLoaded(true);
    document.head.appendChild(script);
  }, [apiKey]);

  // Inicializar servicios
  useEffect(() => {
    if (!isScriptLoaded || !window.google?.maps?.places) return;

    autocompleteServiceRef.current = new google.maps.places.AutocompleteService();

    // Crear un div temporal para PlacesService
    const tempDiv = document.createElement('div');
    const tempMap = new google.maps.Map(tempDiv, { center: { lat: -33.4489, lng: -70.6693 }, zoom: 10 });
    placesServiceRef.current = new google.maps.places.PlacesService(tempMap);
  }, [isScriptLoaded]);

  // Debounce search
  useEffect(() => {
    if (query.length < minChars) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(() => {
      searchPlaces(query);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, minChars, debounceMs]);

  // Cerrar resultados al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchPlaces = useCallback(async (searchQuery: string) => {
    if (!autocompleteServiceRef.current) {
      setIsLoading(false);
      return;
    }

    try {
      autocompleteServiceRef.current.getPlacePredictions(
        {
          input: searchQuery,
          componentRestrictions: { country: 'cl' }, // Chile
          types: ['address']
        },
        (predictions, status) => {
          setIsLoading(false);

          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            const places = predictions.map(p => ({
              placeId: p.place_id,
              address: p.description,
              lat: 0,
              lng: 0
            }));
            setResults(places);
            setShowResults(true);
          } else {
            setResults([]);
          }
        }
      );
    } catch (error) {
      console.error('Error searching places:', error);
      setIsLoading(false);
      setResults([]);
    }
  }, []);

  const handleSelect = useCallback((place: PlaceResult) => {
    if (!placesServiceRef.current) return;

    // Obtener detalles del lugar para las coordenadas
    placesServiceRef.current.getDetails(
      {
        placeId: place.placeId,
        fields: ['geometry', 'formatted_address']
      },
      (result, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && result?.geometry?.location) {
          const selectedPlace: PlaceResult = {
            placeId: place.placeId,
            address: result.formatted_address || place.address,
            lat: result.geometry.location.lat(),
            lng: result.geometry.location.lng()
          };

          onSelect(selectedPlace);
          setQuery('');
          setResults([]);
          setShowResults(false);
        }
      }
    );
  }, [onSelect]);

  if (!apiKey) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
        API Key de Google Maps no configurada
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 animate-spin" />
        )}
      </div>

      {query.length > 0 && query.length < minChars && (
        <p className="mt-1 text-sm text-gray-500">
          Escribe al menos {minChars} caracteres para buscar
        </p>
      )}

      {showResults && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {results.map((place, index) => (
            <button
              key={place.placeId || index}
              onClick={() => handleSelect(place)}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-start gap-3 border-b last:border-b-0"
            >
              <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
              <span className="text-gray-700">{place.address}</span>
            </button>
          ))}
        </div>
      )}

      {showResults && query.length >= minChars && results.length === 0 && !isLoading && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500">
          No se encontraron direcciones
        </div>
      )}
    </div>
  );
}
