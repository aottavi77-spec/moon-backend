# MOON Backend — prototype 0.1.0

Render Web Service:
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Le serveur écoute sur `0.0.0.0` et utilise automatiquement le port `PORT` fourni par Render.

Routes: `GET /health`, `GET /servers`, `GET /queues`, `POST /queue/join`, `GET /queue/TICKET_ID`, `POST /queue/TICKET_ID/cancel`.

Attention : les données sont en mémoire et disparaissent au redémarrage. Les emplacements sont logiques, pas des serveurs de jeu réels. Ce prototype ne démarre aucun jeu et ne fournit aucune compatibilité Fortnite.
