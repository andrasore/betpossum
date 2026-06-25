# Kubernetes manifests

Kustomize manifests for deploying BetPossum to a Kubernetes cluster. Stateful
backends (Postgres, RabbitMQ, TigerBeetle) run in-cluster as StatefulSets; the
app tier and nginx edge run as Deployments; an Ingress fronts nginx.

A shared **base** holds the env-agnostic manifests; two **overlays** carry the
differences:

| Overlay | Entry point | TLS | Secrets | Realm |
|---------|-------------|-----|---------|-------|
| `overlays/local` | `http://localhost:8080` | none | committed dev creds | `keycloak/realm.json` (as-is) |
| `overlays/prod`  | `https://<your-domain>` | cert-manager | `CHANGE_ME` (fill out of band) | `keycloak/realm.prod.json` |

```bash
kubectl apply -k k8s/overlays/local   # local HTTP stack
kubectl apply -k k8s/overlays/prod    # production HTTPS stack
```

> Prod is a starting point, not a turnkey production system. Read the per-file
> comments — several services are pinned to a single replica for correctness
> reasons, and all prod credentials are `CHANGE_ME` placeholders.

## Layout

```
k8s/
  base/            # env-agnostic; defaults to the prod shape. Not applied directly.
  overlays/
    local/         # plain HTTP, dev secrets, single replicas
    prod/          # HTTPS via Ingress + cert-manager, CHANGE_ME secrets
```

`base/` is intentionally not appliable on its own — it carries no Secrets,
Ingress, or `keycloak-realm` ConfigMap (those are per-environment). The local
overlay patches the two values that differ from the base default: the config
`PUBLIC_HOST`/`KEYCLOAK_ISSUER_URL` and the Keycloak `KC_HOSTNAME` scheme.

## Topology

```
            client
               │  http://localhost:8080 (local)  /  https://<domain> (prod, TLS via cert-manager)
        ┌──────▼──────┐
        │   Ingress   │  (NGINX Inc controller, ingressClassName: nginx)
        └──────┬──────┘
               │ 80
        ┌──────▼──────┐   path-routes internally:
        │    nginx    │   /api→core  /odds→odds  /socket.io→notifications
        │  (SPA + LB) │   /kc→keycloak  /→SPA static
        └─┬───┬───┬─┬─┘
          │   │   │ └────────────► keycloak ──► postgres (keycloak db)
          │   │   └──► notifications ─┐
          │   └──► odds ──┐           │ (RabbitMQ fanout)
          └──► core ──────┴───────────┘
                 │  └─► tigerbeetle (ledger)
                 └────► postgres
```

Keycloak is fronted by nginx under `/kc`, so there is a **single origin** and
only one Ingress host.

## Prerequisites

- **NGINX Ingress Controller** (`nginx/nginx-ingress`, the F5/NGINX Inc
  project — <https://hub.docker.com/r/nginx/nginx-ingress/>) installed. The
  Ingress annotations use its `nginx.org/*` prefix, including
  `nginx.org/websocket-services` to keep `/socket.io` upgrading (this controller
  does not enable WebSocket by default).
  - **local:** the controller must be reachable on host **:8080** (e.g. a kind
    cluster with `extraPortMappings` 8080→ingress, or `minikube tunnel`). The
    issuer is `http://localhost:8080/kc/realms/betting`, so the browser URL must
    be exactly `http://localhost:8080`.
- **cert-manager** (prod only) for automatic TLS. Skip if terminating TLS
  elsewhere — see `overlays/prod/ingress.yaml`.
- A cluster with a **default StorageClass** (or set `storageClassName` in each
  StatefulSet's `volumeClaimTemplates`).
- The cluster must be able to reach `ghcr.io` to pull the app images (they are
  public — no pull secret needed).

## 1. Images

The five app images (`core`, `odds`, `notifications`, `frontend`, `keycloak`)
are built and published to `ghcr.io/andrasore/betpossum-*` **automatically by CI
on the PR flow** — there is nothing to build or push by hand for a deploy. The
manifests reference the `:latest` tag with the default `Always` pull policy, so
the cluster pulls the current published image.

The images come from the root multi-stage `Dockerfile` targets (`core`, `odds`,
`notifications`, `frontend`) and `keycloak/Dockerfile`. You can build them
locally for inspection (`docker build --target core -t betpossum-core .`), but
publishing is CI-owned — don't `docker push` them manually.

## 2. Create the keycloak-realm ConfigMap

The realm is imported on first boot and must carry the right URLs for the
environment. Kustomize cannot generate it from a file outside the overlay
directory, so create it out of band (its name, `keycloak-realm`, is what the
Keycloak Deployment mounts):

```bash
kubectl create namespace betpossum    # or apply the overlay first, then create

# local — the committed dev realm already points at http://localhost:8080
kubectl -n betpossum create configmap keycloak-realm \
  --from-file=realm.json=keycloak/realm.json

# prod — copy realm.json to realm.prod.json first and change the betting-frontend
# client to your domain: redirectUris https://<domain>/auth/callback (+ /silent),
# webOrigins https://<domain>, post.logout.redirect.uris https://<domain>/*
kubectl -n betpossum create configmap keycloak-realm \
  --from-file=realm.json=keycloak/realm.prod.json
```

> `--import-realm` only imports a realm that doesn't already exist. To change the
> realm after first boot, edit it via the Keycloak admin API/console, or drop the
> `keycloak` database in the shared Postgres (wiping the postgres PVC would also
> destroy app data, since one Postgres hosts both databases).

## 3. (prod) Fill in placeholders

- `overlays/prod/secrets.yaml` — every `CHANGE_ME` (keep the URL/password pairs
  in sync; see the consistency rule in the file header).
- `base/02-config.yaml` — `PUBLIC_HOST` and `KEYCLOAK_ISSUER_URL` → your domain.
- `overlays/prod/ingress.yaml` — the host (×2); `cluster-issuer.yaml` — the ACME `email`.
- Image references — `ghcr.io/andrasore/...` → your registry, in the `base/` manifests.

The local overlay needs no edits — its secrets are committed dev values.

## 4. Apply

```bash
kubectl apply -k k8s/overlays/local    # or .../prod
```

nginx may `CrashLoopBackOff` for a few seconds until the upstream Services
exist, then stabilizes.

## 5. Reach it

- **local:** browse `http://localhost:8080`.
- **prod:** point your domain at the NGINX Ingress Controller's external IP
  (`kubectl -n nginx-ingress get svc nginx-ingress`); once DNS resolves,
  cert-manager completes the HTTP-01 challenge and issues the cert into
  `betpossum-tls`.

## Local quickstart on k3s

k3s is a quick way to exercise the `local` overlay end to end. Two k3s specifics
to know:

- **k3s ships Traefik**, but the local overlay's Ingress targets
  `ingressClassName: nginx` (NGINX-Inc `nginx.org/*` annotations). Install with
  `--disable traefik` and either install the NGINX-Inc controller, or skip the
  Ingress entirely and port-forward the `nginx` Service (shown below — the
  Service already path-routes everything internally).
- **Images are pulled from the registry.** The app images are public on
  `ghcr.io/andrasore/betpossum-*` and are published automatically by CI on the PR
  flow — there is nothing to build or push by hand. The default `Always` pull
  policy is correct: k3s pulls them directly, no containerd import or pull secret
  needed.

```bash
# 1. k3s without Traefik (it would otherwise grab :80/:443)
curl -sfL https://get.k3s.io | sh -s - --disable traefik
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml          # or copy to ~/.kube/config

# 2. Realm ConfigMap + apply the local overlay (images come from ghcr via CI)
kubectl create namespace betpossum
kubectl -n betpossum create configmap keycloak-realm \
  --from-file=realm.json=keycloak/realm.json
kubectl apply -k k8s/overlays/local

# 3. Reach it on :8080 (straight to the nginx Service — no Ingress controller needed)
kubectl -n betpossum rollout status deploy/nginx
kubectl -n betpossum port-forward svc/nginx 8080:80     # → http://localhost:8080
```

Browse `http://localhost:8080`, register/log in (exercises the
`http://localhost:8080` Keycloak issuer + PKCE) and place a bet (exercises the
`/socket.io` live channel). Once CI publishes a newer image, force a fresh
`Always` pull with:

```bash
kubectl -n betpossum rollout restart deploy/core        # or whichever service
```

> To test through the Ingress instead of port-forwarding the Service, install the
> NGINX-Inc controller (`helm install nginx-ingress nginx-stable/nginx-ingress -n
> nginx-ingress --create-namespace --set controller.service.type=ClusterIP`) and
> port-forward `svc/nginx-ingress-controller 8080:80` — `Host: localhost` matching
> ignores the port, so the `host: localhost` rule still matches. This is the only
> path that exercises the `nginx.org/websocket-services` annotation.

## Scaling caveats (why several services are replicas: 1)

The prod overlay (= `base/`) scales `core` and `nginx` to 2; the local overlay
drops both to 1. The single-replica pins below are correctness constraints.

| Service       | Replicas | Reason |
|---------------|----------|--------|
| core          | 2 (prod) | Safe — its only consumer (events.resolved) uses a durable named queue, so replicas are competing consumers (each event settled once). |
| odds          | 1 | Polling ingester; N replicas = duplicate ingestion/publishes. |
| notifications | 1 | socket.io long-polling handshake must hit one pod; nginx round-robins the Service. |
| keycloak      | 1 | Multi-replica needs a distributed cache (JGroups) not configured here. |
| nginx         | 2 (prod) | Stateless static + proxy — safe to scale. |
| Postgres / RabbitMQ / TigerBeetle | 1 | Single-node StatefulSets; use operators/managed services for real HA. |

These are documented in each manifest. Removing a `replicas: 1` pin requires the
corresponding fix noted there first.
