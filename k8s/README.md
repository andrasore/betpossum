# Kubernetes manifests

Kustomize manifests for deploying BetPossum to a Kubernetes cluster. Stateful
backends (Postgres, RabbitMQ, TigerBeetle) run in-cluster as StatefulSets; the
app tier and nginx edge run as Deployments; an Ingress fronts nginx.

A shared base holds the env-agnostic manifests; two overlays carry the
differences:

| Overlay          | Entry point             | TLS          | Secrets                        | Realm                         |
|------------------|-------------------------|--------------|--------------------------------|-------------------------------|
| `overlays/local` | `http://localhost:8080` | none         | committed dev creds            | `keycloak/realm.json` (as-is) |
| `overlays/prod`  | `https://<your-domain>` | cert-manager | `CHANGE_ME` (fill out of band) | `keycloak/realm.prod.json`    |

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
        │  (SPA + LB) │   /stats→stats  /kc→keycloak  /→SPA static
        └─┬─┬─┬───┬─┬─┘
          │ │ │   │ └──────────────► keycloak ──► postgres (keycloak db)
          │ │ │   └──► notifications ─┐
          │ │ └──► stats ──┐          │
          │ └──► odds ──┐  │          │ (RabbitMQ fanout)
          └──► core ────┴──┴──────────┘
                 │  └─► tigerbeetle (ledger)
                 └────► postgres (core + stats schemas)
```

Keycloak is fronted by nginx under `/kc`, so there is a single origin and
only one Ingress host.

## Prerequisites

- **NGINX Ingress Controller** (`nginx/nginx-ingress`, the F5/NGINX Inc
  project — <https://hub.docker.com/r/nginx/nginx-ingress/>) installed. The
  Ingress annotations use its `nginx.org/*` prefix, including
  `nginx.org/websocket-services` to keep `/socket.io` upgrading (this controller
  does not enable WebSocket by default). Install it via the project's Helm chart
  (note: this is not the community `ingress-nginx` chart — that one ignores
  the `nginx.org/*` annotations):

  ```bash
  helm repo add nginx-stable https://helm.nginx.com/stable
  helm repo update
  helm install nginx-ingress nginx-stable/nginx-ingress \
    -n nginx-ingress --create-namespace \
    -f k8s/overlays/local/nginx-ingress-values.yaml   # local: expose on :8080
  ```

  - **local:** the controller must be reachable on host `:8080`, because the
    issuer is `http://localhost:8080/kc/realms/betting` and the browser URL must
    be exactly `http://localhost:8080`. The committed
    `overlays/local/nginx-ingress-values.yaml` sets the controller Service's HTTP
    port to 8080 (`controller.service.httpPort.port`); on k3s the klipper
    service-LB then binds host `:8080` straight to the controller. On kind, map
    it instead via `extraPortMappings` 8080→ingress (or use `minikube tunnel`).
- **cert-manager** (prod only) for automatic TLS. Skip if terminating TLS
  elsewhere — drop the TLS patch in `overlays/prod/kustomization.yaml`.
- A cluster with a default StorageClass (or set `storageClassName` in each
  StatefulSet's `volumeClaimTemplates`).
- The cluster must be able to reach `ghcr.io` to pull the app images (they are
  public — no pull secret needed).

## 1. Images

The six app images (`core`, `odds`, `notifications`, `stats`, `frontend`,
`keycloak`) are built and published to `ghcr.io/andrasore/betpossum/*`
automatically by CI on the PR flow — there is nothing to build or push by
hand for a deploy. The manifests reference the `:latest` tag with the default
`Always` pull policy, so the cluster pulls the current published image.

The images come from the root multi-stage `Dockerfile` targets (`core`, `odds`,
`notifications`, `stats`, `frontend`) and `keycloak/Dockerfile`. You can build them
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
- the Ingress host — `base/50-ingress.yaml` (`rules` host) and the matching
  tls host in `overlays/prod/kustomization.yaml`; `cluster-issuer.yaml` — the ACME `email`.
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

## 6. (optional) Observability

A Helm-based metrics + logs platform — kube-prometheus-stack (Prometheus +
Grafana + Alertmanager), Loki (log store), and Alloy (log collector) — installs
into a separate `observability` namespace, independent of the `kubectl apply -k`
app deploy. Grafana gets its own Ingress on the same NGINX controller
(`grafana.localhost` locally, `grafana.<domain>` + TLS in prod). See
[`observability/README.md`](observability/README.md) for the install commands and
verification steps.

## Continuous delivery (Flux GitOps)

The steps above are a one-shot manual deploy. For hands-off delivery, a Flux
install on the cluster **pulls** from this repo and rolls out automatically —
nothing needs inbound access to the cluster. The Flux resources live in
[`clusters/prod/`](../clusters/prod); CI already publishes the images.

**Flow.** The CI promote job (post-e2e, on push to `main`) stamps each
e2e-validated image with a sortable, immutable tag `main-<UTC ts>-<sha7>` next to
`:latest`. In-cluster, an `ImageRepository`/`ImagePolicy` per image picks the
newest by `<ts>`, and a single `ImageUpdateAutomation` writes the resolved tag
into the `$imagepolicy` setters in `overlays/prod/kustomization.yaml`, commits to
`main` (with `[ci skip]` so it doesn't retrigger CI), and the `Kustomization`
reconciles it onto the cluster. Rollback is `git revert` of that commit.

```
CI promote ──► GHCR :main-<ts>-<sha7>
                     │  scan
              ImageRepository/ImagePolicy (×6)
                     │  newest tag
              ImageUpdateAutomation ──commit [ci skip]──► git (overlays/prod)
                     │
              Kustomization ──reconcile──► cluster rolls out
```

### CD prerequisites (beyond the deploy prereqs above)

- A **GitHub PAT** with `read:packages` (GHCR scanning) — and repo write for the
  `flux bootstrap` call (bootstrap creates its own deploy key).
- An **age keypair** for SOPS (`age-keygen -o age.agekey`). The private key never
  goes in git.

### 1. Encrypt the prod secrets with SOPS

In a GitOps flow Flux re-applies whatever is in git, so the `CHANGE_ME`
placeholders in `overlays/prod/secrets.yaml` must be replaced by real,
**encrypted** values (the file header already recommends SOPS):

```bash
# Put your age *public* key in .sops.yaml (replace the CHANGE_ME recipient), then:
cp k8s/overlays/prod/secrets.yaml k8s/overlays/prod/secrets.enc.yaml
# fill in the real values, then encrypt in place (matches .sops.yaml rules):
sops --encrypt --in-place k8s/overlays/prod/secrets.enc.yaml

# point the overlay at the encrypted file and drop the plaintext one:
#   overlays/prod/kustomization.yaml: resources: … secrets.yaml → secrets.enc.yaml
git rm k8s/overlays/prod/secrets.yaml   # keep a secrets.example.yaml if you want docs

# load the age *private* key so the cluster can decrypt:
kubectl create namespace flux-system --dry-run=client -o yaml | kubectl apply -f -
kubectl -n flux-system create secret generic sops-age --from-file=age.agekey=age.agekey
```

`clusters/prod/apps.yaml` already declares `decryption: { provider: sops,
secretRef: sops-age }`, so once the file is encrypted Flux decrypts it after
`kustomize build`. (Plaintext resources pass through, so leaving it unencrypted
just applies the `CHANGE_ME` placeholders — encrypt before going live.)

### 2. GHCR scan secret

```bash
kubectl -n flux-system create secret docker-registry ghcr-auth \
  --docker-server=ghcr.io --docker-username=<gh-user> --docker-password=<PAT>
```

### 3. Bootstrap Flux (installs the image-automation controllers too)

```bash
flux bootstrap github \
  --owner=andrasore --repository=betpossum \
  --branch=main --path=clusters/prod \
  --components-extra=image-reflector-controller,image-automation-controller
```

This commits `clusters/prod/flux-system/` and starts reconciling everything
already under `clusters/prod/` — the app `Kustomization`
([`apps.yaml`](../clusters/prod/apps.yaml)) and the image automation
([`image-automation.yaml`](../clusters/prod/image-automation.yaml)).

> The committed image-automation manifests use `image.toolkit.fluxcd.io/v1beta2`.
> Confirm that matches your installed CRDs (`kubectl explain imageupdateautomation`)
> and bump the apiVersion if your Flux serves a newer version.

### 4. Verify

```bash
flux check
flux get sources git
flux get kustomizations          # betpossum → Ready
flux get images all              # policies show a main-* LatestImage
```

Push a trivial change to `main`: CI builds → promote stamps a new
`main-<ts>-<sha7>` → `flux get image policy` picks it up → Flux commits the tag
to `overlays/prod` (`[ci skip]`) → `kubectl -n betpossum get pods` shows the new
image. `git revert` that commit to roll back.

## Local quickstart on k3s

The local setup tries to mimic the prod as closely as possible.
k3s is a quick way to exercise the `local` overlay end to end. Two k3s specifics
to know:

- **k3s ships Traefik** — but the local overlay's Ingress targets
  `ingressClassName: nginx` (NGINX-Inc `nginx.org/*` annotations). Install with
  `--disable traefik`, then install the NGINX-Inc controller with the local
  values file so its Service publishes on `:8080` — k3s' klipper service-LB
  binds that host port straight to the controller.
- **Images are pulled from the registry** — the app images are public on
  `ghcr.io/andrasore/betpossum/*` and are published automatically by CI on the PR
  flow — there is nothing to build or push by hand. The default `Always` pull
  policy is correct: k3s pulls them directly, no containerd import or pull secret
  needed.

```bash
# 1. k3s without Traefik (it would otherwise grab :80/:443)
curl -sfL https://get.k3s.io | sh -s - --disable traefik
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml          # or copy to ~/.kube/config

# 2. NGINX-Inc ingress controller, published on host :8080 (see Prerequisites)
helm repo add nginx-stable https://helm.nginx.com/stable && helm repo update
helm install nginx-ingress nginx-stable/nginx-ingress \
  -n nginx-ingress --create-namespace \
  -f k8s/overlays/local/nginx-ingress-values.yaml

# 3. Realm ConfigMap + apply the local overlay (images come from ghcr via CI)
kubectl create namespace betpossum
kubectl -n betpossum create configmap keycloak-realm \
  --from-file=realm.json=keycloak/realm.json
kubectl apply -k k8s/overlays/local
kubectl -n betpossum rollout status deploy/nginx
```

Browse `http://localhost:8080` (served through the Ingress, so this also
exercises the `nginx.org/websocket-services` annotation), register/log in
(exercises the `http://localhost:8080` Keycloak issuer + PKCE) and place a bet
(exercises the `/socket.io` live channel). Once CI publishes a newer image,
force a fresh `Always` pull with:

```bash
kubectl -n betpossum rollout restart deploy/core        # or whichever service
```

## Scaling caveats (why several services are replicas: 1)

Both overlays run `core` and `nginx` at 2 replicas (the `base/` default). The
single-replica pins below are correctness constraints, not resource choices.

| Service                           | Replicas     | Reason                                                                                                                                |
|-----------------------------------|--------------|---------------------------------------------------------------------------------------------------------------------------------------|
| core                              | 2            | Safe — its only consumer (events.resolved) uses a durable named queue, so replicas are competing consumers (each event settled once). |
| odds                              | 1            | Polling ingester; N replicas = duplicate ingestion/publishes.                                                                         |
| notifications                     | 1            | socket.io long-polling handshake must hit one pod; nginx round-robins the Service.                                                    |
| stats                             | 1 (scalable) | Safe — bets.settled uses a durable queue (competing consumers) and the upsert is idempotent; pinned to 1 only by default.             |
| keycloak                          | 1            | Multi-replica needs a distributed cache (JGroups) not configured here.                                                                |
| nginx                             | 2            | Stateless static + proxy — safe to scale.                                                                                             |
| Postgres / RabbitMQ / TigerBeetle | 1            | Single-node StatefulSets; use operators/managed services for real HA.                                                                 |

These are documented in each manifest. Removing a `replicas: 1` pin requires the
corresponding fix noted there first.
