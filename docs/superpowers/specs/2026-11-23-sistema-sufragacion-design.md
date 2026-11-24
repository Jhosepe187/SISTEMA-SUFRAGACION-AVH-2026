# Sistema de Sufragación AVH — Diseño v1

Fecha: 2026-11-23

## Intención

Votación electrónica para la elección del **Municipio Escolar de la IEP Alexander von Humboldt (Cajamarca)**. Se instalan 2 computadoras como mesas de votación. Los alumnos votan uno tras otro en una cédula al estilo ONPE. El comité ve los resultados en tiempo real, y Google Sheets guarda la base de votos y el reporte final.

## Objetivos

- Flujo: **Inicio → Login → Menú → (Iniciar votación | Ver resultados)**.
- Votación continua: voto → animación del lápiz marcando una X → "Gracias por votar" durante 8 s → la cédula vuelve sola.
- Para salir de la votación hay que volver a iniciar sesión.
- Las 2 PCs muestran siempre el mismo conteo, con un retraso de pocos segundos.
- Resultados: cada lista con su logo y una barra con votos y %, un botón para ver el gráfico global y el total de votos siempre visible.
- Reporte automático en la hoja REPORTE.

## No objetivos (v1)

- Identificar al votante, padrón o control de "un alumno = un voto". Eso lo controla la mesa física.
- Voto en blanco o nulo (se puede agregar en v2).
- Varias elecciones o configurar las listas desde una interfaz.

## Anti-objetivos (sería un fracaso aunque "funcione")

- Que se pierda un voto (por un corte de internet o por dos votos simultáneos).
- Que un voto se cuente dos veces (por reintentos).
- Que un alumno pueda salir de la cédula o ver resultados sin las credenciales.
- Que la cédula se sienta lenta o se trabe entre votantes.

## Restricciones

- Hosting gratuito: **Vercel** (sitio estático).
- Datos: **Google Sheets**.
  - BD: `1OXnQwi6F4ywY156jGIaxQ8bwGCPmR2G1WbdiCAbvEAQ`
  - REPORTE: `1LAR84myX-IEYsXUzv0SjwwNmk_1KWP9wceh-isf1iVM`
- Un solo usuario administrador: `adminAVH`.
- Listas: **UNESI**, **Humbi por siempre**, **AVH Juntos por el cambio** (logos en `Logos/`). Portada: `elementos/inicio.svg`.

## Enfoques considerados

| | Enfoque | Trade-off |
|---|---|---|
| **A (elegido)** | Sitio estático + Google Apps Script publicado como aplicación web (API) sobre la hoja BD; las PCs consultan cada ~3 s | Gratis, sin claves en el sitio, poca configuración. Guardar un voto toma ~1–2 s (lo tapa la pantalla de 8 s). "Tiempo real" = refresco cada pocos segundos |
| B | Funciones de servidor en Vercel + API de Sheets con cuenta de servicio | Mismo resultado con mucha más configuración (Google Cloud, credenciales) |
| C | Firebase + copia a Sheets | Actualización instantánea, pero suma un servicio más para 2 PCs |

El usuario eligió **A**.

## Arquitectura

```
[PC 1 / PC 2: sitio estático en Vercel]
      │  fetch (POST text/plain para evitar preflight CORS)
      ▼
[Apps Script Web App, vinculado a la hoja BD]
      ├─ Hoja "Votos":  timestamp | estacion | lista | vote_id
      ├─ Hoja "Conteo": lista | votos   (contadores, actualizados bajo LockService)
      └─ Escribe resumen en hoja REPORTE (por ID)
```

### API (Apps Script, un único endpoint `doPost` con `action`)

- `login {user, pass}` → valida contra Script Properties y devuelve un `token` aleatorio (guardado en CacheService, 12 h). **Las credenciales no van en el código del sitio.**
- `vote {token, lista, vote_id, estacion}` → bajo `LockService`:
  - si `vote_id` ya se registró, ignora el voto (deduplicación de reintentos);
  - si no, agrega la fila en Votos, incrementa Conteo y actualiza REPORTE.
  - Devuelve los totales.
- `results {token}` → lee Conteo y devuelve `{UNESI, HUMBI, AVH, total, updatedAt}`.
- Las acciones que no son `login` exigen un token válido, para que nadie pueda inyectar votos con la URL del script.

### Frontend (HTML + CSS + JS puro, sin framework ni build)

Pantallas en una sola página (SPA simple con secciones):

1. **Inicio**: portada `inicio.svg` (optimizada) + botón "Ingresar".
2. **Login**: usuario y contraseña → `login` → el token se guarda en `localStorage`, así un F5 no saca la PC de la votación.
3. **Menú**: "Iniciar votación" / "Ver resultados" / "Cerrar sesión".
4. **Cédula**:
   - Encabezado tipo cédula ONPE: "ELECCIÓN DEL MUNICIPIO ESCOLAR 2026", "I.E.P. ALEXANDER VON HUMBOLDT", instrucción "MARCA CON UNA X…".
   - 3 recuadros con nombre y logo.
   - Hover: el logo brilla (drop-shadow animado + leve escala).
   - Clic: un lápiz 3D (SVG/CSS con perspectiva y sombra) dibuja los dos trazos de la X sobre el logo (stroke-dashoffset). Durante la animación la cédula queda bloqueada (sin doble clic). Después se envía el voto.
   - Pantalla "¡Gracias por votar!" durante 8 s → reset.
   - Botón discreto "Salir" en una esquina → modal de login → menú.
5. **Resultados**:
   - Por lista: logo + barra animada + número + %.
   - Botón "Gráfico global": barras comparativas de las 3 listas en un solo gráfico.
   - Total de votos destacado.
   - Refresco cada 3 s, con el indicador "actualizado hace Xs".

### Cola local (anti-pérdida)

Cada voto recibe un `vote_id` (UUID) y se guarda primero en una cola en `localStorage`, que se envía en segundo plano con reintentos. Se borra de la cola solo cuando el servidor confirma. Como el servidor deduplica por `vote_id`, reintentar nunca duplica. Si hay votos pendientes, se muestra un indicador pequeño ("2 votos por sincronizar"). La pantalla de gracias no espera al servidor.

### Estación

Al primer uso, cada PC se identifica como "Mesa 1" o "Mesa 2" (guardado en `localStorage`) y eso queda en la hoja Votos.

### Assets

Los logos SVG (0,8–2,6 MB, PNG incrustado) se convierten a WebP/PNG de ~600 px, y la portada a ~1920 px. Hay que revisar si "AVH Juntos por el cambio" se ve bien en el navegador (Quick Look la mostró en blanco; tiene una máscara).

### Hoja REPORTE

Pestaña "Resumen": Lista | Votos | % | y abajo Total + Última actualización. Se reescribe en cada voto.

## Decidido por el usuario

- Enfoque A, Vercel, Google Sheets como BD y como reporte, 2 PCs sincronizadas, cédula con hover-brillo + lápiz 3D + gracias de 8 s, salida con login, resultados por lista + gráfico global + total.

## Decisiones mías (revisables)

- HTML/CSS/JS sin framework: despliegue trivial y nada que compilar.
- El login se valida en Apps Script (token), no en el navegador, para que la contraseña no quede expuesta en el código.
- Refresco cada 3 s.
- Sin voto en blanco ni nulo en v1.
- Título de la cédula: "Elección del Municipio Escolar 2026".

## Para quien construya

- Estilos finales, la forma exacta del lápiz y los colores (base: azul institucional como en la portada).
- Un archivo `apps-script/Code.gs` + una guía paso a paso para pegarlo y publicarlo (lo hace el usuario con su cuenta Google), y `config.js` con la URL del script.
- Probar el flujo completo en local con un modo simulado ("mock") del API antes de conectar Sheets.
