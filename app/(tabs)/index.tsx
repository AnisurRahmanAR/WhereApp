// index.tsx
// note to self: single scrollable screen with offline cache, Places v1, and high-contrast mode

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// note to self: prefer .env at runtime (EXPO_PUBLIC_GOOGLE_PLACES_API_KEY)
const GOOGLE_PLACES_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? 'AIzaSyCy1Hhs2w01deE3kHPouxSvNKhqADGYG_U';

// ---------- helpers ----------
function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const λ1 = (from.lng * Math.PI) / 180;
  const λ2 = (to.lng * Math.PI) / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return Math.round(deg);
}
function bearingToCompass(deg: number) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
  return dirs[Math.round(deg / 45)];
}
function formatDistance(m: number) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}
function ts() {
  return new Date().toISOString();
}
function timeShort(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

// ---------- types ----------
type SimplePlace = {
  id: string;
  name: string;
  vicinity?: string;
  distance: number;
  compass: string;
};
type FilterKey = 'poi' | 'hospital' | 'police' | 'fire_station';

// v1: includedTypes per filter (poi uses a few broad buckets)
const FILTER_TO_TYPES_V1: Record<FilterKey, string[]> = {
  poi: ['tourist_attraction', 'point_of_interest', 'establishment'],
  hospital: ['hospital'],
  police: ['police'],
  fire_station: ['fire_station'],
};

// ---------- offline cache keys ----------
const CK = {
  location: 'cache:lastLocation',   // {lat,lng,updatedAt}
  address:  'cache:lastAddress',    // string
  places:   'cache:lastPlaces',     // SimplePlace[]
};

// ---------- themes ----------
const LIGHT = {
  bg: '#ffffff',
  text: '#111111',
  sub: '#222222',
  muted: '#666',
  card: '#f5f7fb',
  accent: '#0A84FF',
  danger: '#d00',
  border: '#cfd6e4',
};
const DARK = {
  bg: '#0b0f14',
  text: '#ffffff',
  sub: '#e5e7eb',
  muted: '#cfd6e4',
  card: '#11161d',
  accent: '#4da3ff',
  danger: '#ff2d55',
  border: '#263341',
};

// build styles from theme so toggle is easy
const makeStyles = (C: typeof LIGHT) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.bg },
    listContent: { paddingHorizontal: 16, paddingBottom: 32 },

    headerBlock: { paddingTop: 8, paddingBottom: 10, alignItems: 'center' },
    title: { fontSize: 34, fontWeight: '800', marginBottom: 4, color: C.text },
    subtitle: { fontSize: 16, color: C.sub, textAlign: 'center', marginBottom: 6 },
    address: { fontSize: 14, color: C.sub, textAlign: 'center' },

    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 12 },
    chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg },
    chipActive: { backgroundColor: C.accent, borderColor: C.accent },
    chipText: { fontSize: 14, color: C.accent, fontWeight: '600' },
    chipTextActive: { color: '#fff' },

    staleBanner: {
      marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
      backgroundColor: C.card, alignItems: 'center',
    },
    staleText: { color: C.muted, fontSize: 12 },

    placesTitle: { fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8, textAlign: 'center', color: C.text },

    placeRow: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.card, marginBottom: 8 },
    placeName: { fontSize: 16, fontWeight: '600', color: C.text, textAlign: 'center' },
    placeMeta: { fontSize: 14, color: C.sub, opacity: 0.95, marginTop: 2, textAlign: 'center' },

    footerBlock: { marginTop: 16, marginBottom: 10, alignItems: 'center' },
    actionsTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: C.text },
    callRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', width: '100%', marginBottom: 10 },
    callBtn: { flexGrow: 1, maxWidth: 120, backgroundColor: C.danger, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    callPrimary: { backgroundColor: C.danger },
    callText: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 1 },
    shareBtn: { backgroundColor: C.accent, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center', width: '100%' },
    shareText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.4 },

    placeholder: { textAlign: 'center', color: C.muted, fontSize: 14 },
  });

// ---------- app ----------
export default function App() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<string | undefined>(undefined);
  const [address, setAddress] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [places, setPlaces] = useState<SimplePlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>('poi');

  const [highContrast, setHighContrast] = useState<boolean>(true); // default to “Emergency Mode”
  const [isStale, setIsStale] = useState<boolean>(false); // shows if we’re displaying cached data

  const C = highContrast ? DARK : LIGHT;
  const styles = useMemo(() => makeStyles(C), [highContrast]);

  // --- offline cache helpers ---
  const saveCache = async (coords: { lat: number; lng: number } | null, addr: string, ps: SimplePlace[]) => {
    try {
      if (coords) {
        await AsyncStorage.setItem(CK.location, JSON.stringify({ ...coords, updatedAt: ts() }));
      }
      await AsyncStorage.setItem(CK.address, addr || '');
      await AsyncStorage.setItem(CK.places, JSON.stringify(ps));
    } catch {}
  };
  const loadCache = async () => {
    try {
      const [locStr, addrStr, placesStr] = await Promise.all([
        AsyncStorage.getItem(CK.location),
        AsyncStorage.getItem(CK.address),
        AsyncStorage.getItem(CK.places),
      ]);
      const loc = locStr ? JSON.parse(locStr) : null;
      const ps = placesStr ? (JSON.parse(placesStr) as SimplePlace[]) : [];
      if (loc) {
        // note to self: set a “synthetic” location object so rest of code can read coords
        const fakeLoc: any = {
          coords: { latitude: loc.lat, longitude: loc.lng },
        };
        setLocation(fakeLoc);
        setLocationUpdatedAt(loc.updatedAt);
      }
      if (addrStr) setAddress(addrStr);
      if (ps.length) setPlaces(ps);
      if (loc || ps.length) setIsStale(true); // we’re showing cached data until live fetch succeeds
    } catch {}
  };

  // --- Places API v1 fetch ---
  const fetchNearbyPlacesV1 = async (latitude: number, longitude: number, filter: FilterKey) => {
    const radius = 1200.0; // meters
    const includedTypes = FILTER_TO_TYPES_V1[filter];

    try {
      setLoadingPlaces(true);

      const resp = await axios.post(
        'https://places.googleapis.com/v1/places:searchNearby',
        {
  includedTypes,
  maxResultCount: 12,
  rankPreference: 'DISTANCE',
  locationRestriction: { circle: { center: { latitude, longitude }, radius } },
  languageCode: 'en',
},
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
          },
          timeout: 8000,
        }
      );

      // normalize to our SimplePlace[]
      const me = { lat: latitude, lng: longitude };
      const list: SimplePlace[] = (resp.data?.places ?? [])
        .filter((p: any) => p?.location?.latitude && p?.location?.longitude)
        .map((p: any) => {
          const lat = p.location.latitude;
          const lng = p.location.longitude;
          const d = distanceMeters(me, { lat, lng });
          const b = bearingDeg(me, { lat, lng });
          return {
            id: p.id,
            name: p.displayName?.text ?? 'Unnamed place',
            vicinity: p.formattedAddress,
            distance: d,
            compass: bearingToCompass(b),
          };
        })
        .sort((a: SimplePlace, b: SimplePlace) => a.distance - b.distance);

      setPlaces(list);
      setIsStale(false); // we have fresh data now
      // cache for offline use
      await saveCache(me, address, list);
    } catch (err: any) {
      console.log('❌ Places v1 error:', err?.response?.status, err?.response?.data || err?.message);
      // keep whatever we had (possibly cached) and mark as stale
      setIsStale(true);
    } finally {
      setLoadingPlaces(false);
    }
  };

  // --- share + call ---
  const handleCall = (num: string) => Linking.openURL(`tel:${num}`);
  const handleShareLocation = async () => {
    if (!location) return;
    const lat = location.coords.latitude.toFixed(6);
    const lng = location.coords.longitude.toFixed(6);
    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    const parts = [
      `My location: ${lat}, ${lng}`,
      address ? `Address: ${address}` : null,
      `Map: ${mapsUrl}`,
    ].filter(Boolean);
    const text = parts.join('\n');
    await Clipboard.setStringAsync(text);
    await Share.share({ message: text });
  };

  // --- initial load: show cache immediately, then try live ---
  useEffect(() => {
    (async () => {
      await loadCache(); // show last known data now

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      // live coordinates (even if we had cache)
      const loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
      setLocationUpdatedAt(ts());

      // human-readable address
      try {
        const addr = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        const line = [addr[0]?.name, addr[0]?.street, addr[0]?.city, addr[0]?.region, addr[0]?.postalCode]
          .filter(Boolean)
          .join(', ');
        setAddress(line);
      } catch {}

      // live places via v1
      await fetchNearbyPlacesV1(loc.coords.latitude, loc.coords.longitude, selectedFilter);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refetch when filter changes (if we have a location)
  useEffect(() => {
    if (!location) return;
    fetchNearbyPlacesV1(location.coords.latitude, location.coords.longitude, selectedFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilter]);

  // --- header/footer/items (scroll with list) ---
  const Header = () => {
    let statusText = 'Waiting for location...';
    if (errorMsg) statusText = errorMsg;
    else if (location) statusText = `Lat: ${location.coords.latitude.toFixed(5)}, Lon: ${location.coords.longitude.toFixed(5)}`;

    return (
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Where?</Text>

        <Text style={styles.subtitle}>{statusText}</Text>
        {!!address && <Text style={styles.address}>{address}</Text>}

        {/* stale banner if showing cached data */}
        {isStale && (
          <View style={styles.staleBanner}>
            <Text style={styles.staleText}>
              Showing last known results{locationUpdatedAt ? ` • updated ${timeShort(locationUpdatedAt)}` : ''}
            </Text>
          </View>
        )}

        {/* theme + filters */}
        <View style={styles.filterRow}>
          {/* High-contrast toggle */}
          <TouchableOpacity
            style={[styles.chip, highContrast && styles.chipActive]}
            onPress={() => setHighContrast((x) => !x)}
          >
            <Text style={[styles.chipText, highContrast && styles.chipTextActive]}>
              {highContrast ? 'High Contrast: ON' : 'High Contrast: OFF'}
            </Text>
          </TouchableOpacity>

          {(['poi','hospital','police','fire_station'] as FilterKey[]).map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.chip, selectedFilter === key && styles.chipActive]}
              onPress={() => setSelectedFilter(key)}
            >
              <Text style={[styles.chipText, selectedFilter === key && styles.chipTextActive]}>
                {key === 'poi' ? 'All' : key === 'fire_station' ? 'Fire' : key[0].toUpperCase() + key.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.placesTitle}>
          {selectedFilter === 'poi' ? 'Nearby Landmarks'
            : selectedFilter === 'hospital' ? 'Nearby Hospitals'
            : selectedFilter === 'police' ? 'Nearby Police'
            : 'Nearby Fire Stations'}
        </Text>
      </View>
    );
  };

  const Footer = () => (
    <View style={styles.footerBlock}>
      <Text style={styles.actionsTitle}>Emergency</Text>

      <View style={styles.callRow}>
        <TouchableOpacity style={[styles.callBtn, styles.callPrimary]} onPress={() => handleCall('999')}>
          <Text style={styles.callText}>999</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.callBtn} onPress={() => handleCall('112')}>
          <Text style={styles.callText}>112</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.callBtn} onPress={() => handleCall('911')}>
          <Text style={styles.callText}>911</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.shareBtn} onPress={handleShareLocation}>
        <Text style={styles.shareText}>Share my location</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPlace = ({ item }: { item: SimplePlace }) => (
    <View style={styles.placeRow}>
      <Text style={styles.placeName}>{item.name}</Text>
      <Text style={styles.placeMeta}>
        {formatDistance(item.distance)} {item.compass}
        {item.vicinity ? ` • ${item.vicinity}` : ''}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={places}
        keyExtractor={(item) => item.id}
        renderItem={renderPlace}
        ListHeaderComponent={<Header />}
        ListFooterComponent={<Footer />}
        ListEmptyComponent={
          <View style={{ paddingVertical: 20 }}>
            {loadingPlaces ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : (
              <Text style={styles.placeholder}>No results yet.</Text>
            )}
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}