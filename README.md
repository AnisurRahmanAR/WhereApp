# 🧭 Where? — Emergency Location App

A cross-platform React Native app (built with Expo) that helps users quickly share and describe their location to emergency services — even when unfamiliar with their surroundings.

## 🚀 Features
- Real-time GPS coordinates and reverse-geocoded address  
- Nearby landmarks with distance + compass direction  
- Offline fallback (caches last known data)  
- One-tap emergency dial buttons (999 / 112 / 911)  
- “Share my location” with map link and clipboard copy  
- High-contrast emergency mode  
- Powered by Google Places API (New)

## 🧰 Tech Stack
- **Expo + React Native (TypeScript)**
- **Google Places API (v1)**
- **expo-location**, **expo-clipboard**, **AsyncStorage**, **Axios**

## 🧩 Setup
```bash
git clone https://github.com/<your-username>/where-app.git
cd where-app
cp .env.example .env  # Add your Google Places API key here
npm install
npx expo start
