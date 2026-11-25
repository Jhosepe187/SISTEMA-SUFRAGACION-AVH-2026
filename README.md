# Sistema de Sufragación AVH

Votación electrónica para las **Elecciones del Municipio Escolar 2026** de la I.E.P. Alexander von Humboldt (Cajamarca).

**Flujo:** Inicio → Login → Menú → *Iniciar votación* (cédula continua) / *Ver resultados* (tiempo real).
Los votos se guardan en Google Sheets y las 2 mesas de votación muestran el mismo conteo.

## Estructura

```
public/            sitio web (lo que se publica en Vercel)
  index.html
  css/styles.css
  js/config.js       ← aquí va la URL de Google (API_URL)
  js/app.js          pantallas, sesión, mesa, sincronización
  js/ballot.js       cédula, brillo, lápiz 3D, "Gracias por votar"
  js/results-view.js resultados por lista y gráfico global
  js/api.js          conexión con Google + modo prueba
  js/logic.js        porcentajes y cola de votos (anti-pérdida)
  assets/            logos y portada optimizados
apps-script/       código para Google Sheets + guía de instalación
tests/             pruebas automáticas (npm test)
docs/superpowers/  diseño y plan
```

## Probar en tu computadora (modo prueba)

Mientras `API_URL` esté vacía en `public/js/config.js`, el sitio funciona en **MODO PRUEBA**: los votos se simulan en el navegador. Si abres dos pestañas, simulan las dos mesas.

```bash
python3 -m http.server 8080 -d public
```

Abre http://localhost:8080. En modo prueba el usuario y la contraseña son `prueba` / `prueba`. En modo real se usa la cuenta del comité, que se guarda **solo** en Google (Propiedades del script), nunca en este repositorio.

Para reiniciar el modo prueba, abre la consola del navegador y ejecuta `localStorage.clear()`.

## Conectar con Google Sheets

Sigue [apps-script/INSTALACION.md](apps-script/INSTALACION.md) (unos 10 minutos, una sola vez). Al terminar, pega la URL `/exec` en `public/js/config.js`.

## Publicar en Vercel

El proyecto de Vercel **sufragacion-avh-2026** está conectado a este repositorio:
**cada push a `main` se publica solo** en https://sufragacion-avh-2026.vercel.app (tarda ~30 s).

- En cada despliegue, `scripts/stamp.mjs` agrega una versión única (`?v=...`) a scripts, estilos y logos,
  para que los navegadores siempre carguen lo último.
- Publicar a mano (opcional): `npx vercel --prod`.

## El día de la votación

1. En Apps Script, ejecuta `reiniciarEleccion` para borrar los votos de prueba (ver la guía).
2. En cada PC: abre el sitio → inicia sesión → elige **Mesa 1** o **Mesa 2** → *Iniciar votación*. Conviene poner el navegador en pantalla completa (F11).
3. Los resultados se pueden ver desde cualquier dispositivo iniciando sesión → *Ver resultados*.
4. Si se va el internet, la mesa sigue votando: abajo a la derecha (y en el menú) aparece "N votos por sincronizar" y los votos se envían solos al volver la conexión. **No borres los datos del navegador mientras haya votos pendientes.**
5. **No uses ventanas de incógnito o privadas** en las mesas: ahí el navegador puede no guardar la cola de votos pendientes.
6. Antes de anunciar los resultados, revisa que las dos mesas muestren "● Conectado" (0 votos por sincronizar).

## Pruebas

```bash
npm test
```

## Documentación

- Diseño: [docs/superpowers/specs/2026-11-23-sistema-sufragacion-design.md](docs/superpowers/specs/2026-11-23-sistema-sufragacion-design.md)
- Plan: [docs/superpowers/plans/2026-11-23-sistema-sufragacion.md](docs/superpowers/plans/2026-11-23-sistema-sufragacion.md)
