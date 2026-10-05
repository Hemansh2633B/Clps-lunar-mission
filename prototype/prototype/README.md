# Lunar south-pole planning console prototype

A separate visual prototype for the existing lunar terrain simulator. It reuses the project's local DEM API, verified coordinate calculations, Three.js terrain mesh, and directional Sun/shadow controller. It adds no API key, external terrain service, generated real-mode terrain, SPICE output, or Earth-visibility estimate.

From the project root, start the backend and local frontend:

```powershell
python -m backend.server --dem-config data/lola_example_config.json
```

Open **http://127.0.0.1:8000/prototype/**. Use the same dependency installation documented in the root README. On Windows, if using the project virtual environment, run:

```powershell
.\.venv\Scripts\python.exe -m backend.server --dem-config data/lola_example_config.json
```

The prototype's **Build terrain** action calls `/api/terrain`. It starts in Real lunar DEM mode when a configured DEM is ready and otherwise uses the clearly labeled synthetic demo. Source metadata, coverage gaps, elevations, and the landing location come from the running backend. Sun angles are manual directional-light controls; they are not date-based ephemerides.

This is an isolated interface exploration. The established application remains at `/`.
