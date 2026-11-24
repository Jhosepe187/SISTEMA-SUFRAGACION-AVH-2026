// Configuración general del sistema de sufragación AVH.

// URL de la aplicación web de Google Apps Script (ver apps-script/INSTALACION.md).
// Mientras esté vacía, el sitio funciona en MODO PRUEBA (votos simulados en este navegador).
export const API_URL = '';

export const LISTAS = [
  { key: 'UNESI', nombre: 'UNESI', logo: 'assets/unesi.webp', color: '#f5c518' },
  { key: 'HUMBI', nombre: 'Humbi por siempre', logo: 'assets/humbi.webp', color: '#3d7bff' },
  { key: 'AVH', nombre: 'AVH Juntos por el cambio', logo: 'assets/avh.webp', color: '#2ec4b6' },
];

export const THANKS_MS = 8000; // pantalla "Gracias por votar"
export const POLL_MS = 3000; // refresco de resultados
export const RETRY_MS = 5000; // reintento de votos pendientes

// Modo prueba solo mientras no haya URL de Google: así nunca se mezclan votos reales con simulados.
export const MOCK = API_URL === '';
// Claves de almacenamiento separadas para el modo prueba.
export const KEY_PREFIX = MOCK ? 'avh_mock_' : 'avh_';
