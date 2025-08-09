# SkyGrid (SkyJo-kompatibel) – Full Stack

## Start (Produktion, mit HTTPS)
```bash
docker compose build
docker compose up -d
# Browser: https://grid.skyserver.online
```

## DNS
Setze bei deinem Domain-Provider (Strato) einen A-Record:
- grid.skyserver.online -> <deine Server-IP>

Zertifikate werden automatisch von Caddy bezogen (Let's Encrypt). Der erste Abruf kann 1–2 Minuten dauern.
