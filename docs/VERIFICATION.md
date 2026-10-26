# Verification record

Verified on 26 October 2026 using Node.js 24.13.0 on Windows.

## Passed

- `npm ci`: React, React DOM, Vite, and the chat dependencies installed from the lockfile in the Downloads project; npm audit reported zero known vulnerabilities at installation time.
- `npm run check`: backend, chat hook, and Vite configuration syntax checks.
- `npm run build`: React production build completed with Vite 8.3.5 and React 19.3.1.
- `npm test`: five tests covering names, symmetric direct conversation IDs, message boundaries, rate-limit recovery, and Kubernetes manifest parsing/consistency.
- `docker compose config --quiet`: Compose configuration validation, without running containers.
- `npm run test:integration`: real Node.js replicas with real Redis 7.4.11. Verified direct-message privacy from a third user, sender identity, per-pair history isolation, public group creation and membership, cross-replica delivery, online presence, typing, payload rejection, history cap/expiry, draining probes, and resuming the same user/group membership on a surviving replica.
- Browser verification: separate users exchanged DMs and group messages, created a group, saw unread indicators, switched conversations, refreshed to resume their identity, and restored retained history. HTML-like content rendered literally without injected image elements.
- A controlled preview-server restart disabled messaging while disconnected, then automatically restored the same session, active group and message history. No browser warnings/errors were reported by the browser log tool.
- Responsive checks: desktop people/group sidebar at 1280 × 800 and mobile conversation picker at 390 × 844. The mobile page had no horizontal overflow.
- Local HTTP preview: readiness returned HTTP 200 and the working page was opened in the browser.

The integration environment used a temporary, checksum-verified [Redis Windows build](https://github.com/redis-windows/redis-windows/releases/tag/7.4.11) bound to loopback on port 16379. That test runtime is not part of the deliverable and is not a project dependency. Project deployment uses the official `redis:7.4-alpine` image.

## Not executed on this machine

- Docker image build and Compose container startup: Docker Desktop's Linux engine was unavailable. Its existing WSL runtime reported missing system files and startup timed out.
- Kubernetes deployment, live Service/DNS routing, scaling, rolling update and rollback: no Kubernetes context/cluster was configured.

The manifests were parsed and checked locally, but that does not prove cluster deployment. Follow the README and DevOps lab to run these exercises on a working Docker/Kubernetes environment. No claim of successful container or cluster deployment is made.

The application uses real Redis and real WebSockets. It does not substitute a simulated chat backend when infrastructure is unavailable.
