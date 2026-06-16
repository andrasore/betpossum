# Production Kubernetes manifests

Plain-YAML manifests for deploying BetPossum to a Kubernetes cluster. Stateful
backends (Postgres ×2, RabbitMQ, TigerBeetle) run in-cluster as StatefulSets;
the app tier and nginx edge run as Deployments; an Ingress + cert-manager
terminate TLS.

> These are a starting point, not a turnkey production system. Read the
> per-file comments — several services are pinned to a single replica for
> correctness reasons, and all credentials are `CHANGE_ME` placeholders.

## Topology

```
            Internet
               │  443 (TLS via cert-manager)
        ┌──────▼──────┐
        │   Ingress   │  betpossum.example.com
        └──────┬──────┘
               │ 80
        ┌──────▼──────┐   path-routes internally:
        │    nginx    │   /api→core  /odds→odds  /socket.io→notifications
        │  (SPA + LB) │   /kc→keycloak  /→SPA static
        └─┬───┬───┬─┬─┘
          │   │   │ └────────────► keycloak ──► keycloak-postgres
          │   │   └──► notifications ─┐
          │   └──► odds ──┐           │ (RabbitMQ fanout)
          └──► core ──────┴───────────┘
                 │  └─► tigerbeetle (ledger)
                 └────► postgres
```

Keycloak is fronted by nginx under `/kc`, so there is a **single public origin**
and only one Ingress host.

## Prerequisites

- A cluster with a **default StorageClass** (or set `storageClassName` in each
  StatefulSet's `volumeClaimTemplates`).
- **ingress-nginx** controller installed.
- **cert-manager** installed (for automatic TLS). Skip if terminating TLS
  elsewhere — see `50-ingress.yaml`.
- A container registry you can push to. The manifests use
  `ghcr.io/andrasore/betpossum-*` placeholders — replace with yours.

## 1. Build and push images

Four app images come from the root multi-stage `Dockerfile` targets; Keycloak
from `keycloak/Dockerfile`. From the repo root:

```bash
REG=ghcr.io/andrasore
for tgt in core odds notifications frontend; do
  docker build --target $tgt -t $REG/betpossum-$tgt:latest .
  docker push $REG/betpossum-$tgt:latest
done
docker build -t $REG/betpossum-keycloak:latest keycloak/
docker push $REG/betpossum-keycloak:latest
```

## 2. Fill in placeholders

- `02-config.yaml` — `PUBLIC_HOST` and `KEYCLOAK_ISSUER_URL` → your domain.
- `01-secrets.yaml` — every `CHANGE_ME` (keep the URL/password pairs in sync).
- `50-ingress.yaml` — the host (×2), and the ACME `email`.
- Image references — `ghcr.io/andrasore/...` → your registry, in `20`/`30`/`31`/`32`/`40`.

## 3. Create the Keycloak realm ConfigMap

The realm is imported on first boot and must carry **production** URLs. Copy
`keycloak/realm.json` to `keycloak/realm.prod.json` and change the
`betting-frontend` client to your domain:

- `redirectUris`: `["https://betpossum.example.com/auth/callback"]`
- `webOrigins`: `["https://betpossum.example.com"]`
- `post.logout.redirect.uris`: `https://betpossum.example.com/*`

Then create the ConfigMap the Keycloak Deployment mounts:

```bash
kubectl create namespace betpossum   # or apply 00-namespace.yaml first
kubectl -n betpossum create configmap keycloak-realm \
  --from-file=realm.json=keycloak/realm.prod.json
```

> `--import-realm` only imports a realm that doesn't already exist. To change the
> realm after first boot you must edit it via the Keycloak admin API/console or
> reset the keycloak-postgres volume.

## 4. Apply

```bash
kubectl apply -f k8s/
```

Files are numbered so a plain `apply -f` creates them in a sane order
(namespace → secrets/config → stateful backends → keycloak → app tier → nginx →
ingress). nginx may `CrashLoopBackOff` for a few seconds until the upstream
Services exist, then stabilizes.

## 5. DNS

Point `betpossum.example.com` at the ingress-nginx controller's external IP:

```bash
kubectl -n ingress-nginx get svc ingress-nginx-controller
```

Once DNS resolves, cert-manager completes the HTTP-01 challenge and issues the
cert into `betpossum-tls`.

## Scaling caveats (why several services are replicas: 1)

| Service       | Replicas | Reason |
|---------------|----------|--------|
| core          | 2 | Safe — its only consumer (events.resolved) uses a durable named queue, so replicas are competing consumers (each event settled once). |
| odds          | 1 | Polling ingester; N replicas = duplicate ingestion/publishes. |
| notifications | 1 | socket.io long-polling handshake must hit one pod; nginx round-robins the Service. |
| keycloak      | 1 | Multi-replica needs a distributed cache (JGroups) not configured here. |
| nginx         | 2 | Stateless static + proxy — safe to scale. |
| Postgres / RabbitMQ / TigerBeetle | 1 | Single-node StatefulSets; use operators/managed services for real HA. |

These are documented in each manifest. Removing a `replicas: 1` pin requires the
corresponding fix noted there first.
