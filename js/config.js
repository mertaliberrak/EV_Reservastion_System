/**
 * EVCharge — Yapılandırma Dosyası
 * API ve harita ayarları.
 */

const Config = {
    // API Base URL — backend sunucusu
    API_BASE_URL: '/api',

    // Google Maps API Key artık backend'den geliyor (güvenlik)
    // Bu değer sayfa yüklendiğinde API'den çekilecek
    GOOGLE_MAPS_API_KEY: null,

    // Varsayılan harita merkezi (İzmir)
    DEFAULT_CENTER: { lat: 38.4237, lng: 27.1428 },
    DEFAULT_ZOOM: 12,
};
