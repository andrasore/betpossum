# Kubernetes manifests

Kustomize manifests for deploying BetPossum to a Kubernetes cluster. Stateful
backends (Postgres, RabbitMQ, TigerBeetle) run in-cluster as StatefulSets; the
app tier and nginx edge run as Deployments; an Ingress fronts nginx.

A shared base holds the env-agnostic manifests; two overlays carry the
differences:

| Overlay          | Entry point             | TLS                    | Secrets                              | Realm                         |
|------------------|-------------------------|------------------------|--------------------------------------|-------------------------------|
| `overlays/local` | `http://localhost:8080` | none                   | committed dev creds                  | `keycloak/realm.json` (as-is) |
| `overlays/prod`  | `https://<your-domain>` | cert you provide       | deployment-specific (you supply)     | `keycloak/realm.prod.json`    |

```bash
kubectl apply -k k8s/overlays/local   # local HTTP stack
kubectl apply -k k8s/overlays/prod    # production HTTPS stack
```

> Prod is a starting point, not a turnkey production system. Read the per-file
> comments — several services are pinned to a single replica for correctness
> reasons, and prod carries no credentials at all (you supply them).

## Layout

```
k8s/
  base/            # env-agnostic; defaults to the prod shape. Not applied directly.
  overlays/
    local/         # plain HTTP, dev secrets, single replicas
    prod/          # HTTPS via Ingress (TLS cert you provide); no secrets (supplied per deployment)
```

`base/` is intentionally not appliable on its own — it carries no Secrets,
Ingress, or `keycloak-realm` ConfigMap (those are per-environment). The local
overlay patches the two values that differ from the base default: the config
`PUBLIC_HOST`/`KEYCLOAK_ISSUER_URL` and the Keycloak `KC_HOSTNAME` scheme.

## Topology

```
            client
               │  http://localhost:8080 (local)  /  https://<domain> (prod, TLS from betpossum-tls)
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

The seven app images (`core`, `odds`, `notifications`, `stats`, `frontend`,
`keycloak`, `bots`) are built and published to `ghcr.io/andrasore/betpossum/*`
automatically by CI on the PR flow — there is nothing to build or push by
hand for a deploy. The manifests reference the `:latest` tag with the default
`Always` pull policy, so the cluster pulls the current published image.

The images come from the root multi-stage `Dockerfile` targets (`core`, `odds`,
`notifications`, `stats`, `frontend`, `bots`) and `keycloak/Dockerfile`. You can
build them locally for inspection (`docker build --target core -t betpossum-core .`),
but publishing is CI-owned — don't `docker push` them manually.

`bots` is the synthetic play-data generator (`k8s/base/34-bots.yaml`): it
provisions bot users via the Keycloak admin API, funds them through the app
admin (`bob`), and places bets through the nginx origin so the leaderboard stays
active. Its master-admin creds come from the `keycloak-secret` Secret; keep it at
`replicas: 1` (it is not horizontally scalable).

## Prerequisites

Shared by both deployment paths:

- **NGINX Ingress Controller** (`nginx/nginx-ingress`, the F5/NGINX Inc
  project — <https://hub.docker.com/r/nginx/nginx-ingress/>) installed. The
  Ingress annotations use its `nginx.org/*` prefix, including
  `nginx.org/websocket-services` to keep `/socket.io` upgrading (this controller
  does not enable WebSocket by default). Install it via the project's Helm chart
  (note: this is not the community `ingress-nginx` chart — that one ignores
  the `nginx.org/*` annotations).
- A cluster with a default StorageClass (or set `storageClassName` in each
  StatefulSet's `volumeClaimTemplates`).
- The cluster must be able to reach `ghcr.io` to pull the app images (they are
  public — no pull secret needed).

## Local deployment (k3s)

Plain HTTP on `http://localhost:8080`, on a single-node [k3s](https://k3s.io)
cluster — a quick way to exercise the `local` overlay end to end while mimicking
prod as closely as possible. The local overlay commits throwaway dev secrets
(`betting_dev`, Keycloak `admin`/`admin`), so there is nothing to fill in — never
reuse them anywhere reachable. The steps:

- **Install k3s without Traefik.** k3s ships Traefik, but the local overlay's
  Ingress targets `ingressClassName: nginx` (NGINX-Inc `nginx.org/*`
  annotations), and Traefik would otherwise grab `:80`/`:443`. Disable it at
  install:

  ```bash
  curl -sfL https://get.k3s.io | sh -s - --disable traefik
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml          # or copy to ~/.kube/config
  ```

  k3s ships a default StorageClass (local-path) and pulls the public
  `ghcr.io/andrasore/betpossum/*` images directly, so no StorageClass setup,
  containerd import, or pull secret is needed.

- **Install the NGINX Ingress Controller, published on host `:8080`.** The issuer
  is `http://localhost:8080/kc/realms/betting` and the browser URL must be exactly
  `http://localhost:8080`, so the controller has to answer on that host port. The
  committed `overlays/local/nginx-ingress-values.yaml` sets the controller
  Service's HTTP port to 8080 (`controller.service.httpPort.port`); k3s' klipper
  service-LB then binds host `:8080` straight to the controller:

  ```bash
  helm repo add nginx-stable https://helm.nginx.com/stable && helm repo update
  helm install nginx-ingress nginx-stable/nginx-ingress \
    -n nginx-ingress --create-namespace \
    -f k8s/overlays/local/nginx-ingress-values.yaml
  ```

- **Create the `keycloak-realm` ConfigMap** from the committed dev realm (already
  points at `http://localhost:8080`). Kustomize cannot generate it from a file
  outside the overlay directory, so create it out of band — its name,
  `keycloak-realm`, is what the Keycloak Deployment mounts:

  ```bash
  kubectl create namespace betpossum
  kubectl -n betpossum create configmap keycloak-realm \
    --from-file=realm.json=keycloak/realm.json
  ```

- **Apply the local overlay.** nginx may `CrashLoopBackOff` for a few seconds
  until the upstream Services exist, then stabilizes:

  ```bash
  kubectl apply -k k8s/overlays/local
  kubectl -n betpossum rollout status deploy/nginx
  ```

- **Reach it** — browse `http://localhost:8080`. Register/log in (exercises the
  `http://localhost:8080` Keycloak issuer + PKCE) and place a bet (exercises the
  `/socket.io` live channel). Once CI publishes a newer image, force a fresh
  `Always` pull with `kubectl -n betpossum rollout restart deploy/core` (or
  whichever service).

> `--import-realm` only imports a realm that doesn't already exist. To change the
> realm after first boot, edit it via the Keycloak admin API/console, or drop the
> `keycloak` database in the shared Postgres (wiping the postgres PVC would also
> destroy app data, since one Postgres hosts both databases).

> On kind or minikube instead of k3s, the ingress controller won't be reachable
> on host `:8080` automatically — map it via kind `extraPortMappings` 8080→ingress,
> or use `minikube tunnel`.

## Prod deployment (Flux GitOps)

Prod is HTTPS via Ingress (TLS cert you provide) and ships **no secrets** — the
`overlays/prod` you see here is a deployment-independent example that builds
cleanly but leaves the pods without credentials until you supply them.

The recommended path is **GitOps**: [Flux](https://fluxcd.io) reconciles the
cluster from git and writes newer image tags back — but its image automation must
**commit** to a repo, which a public repo cannot grant safely. So the deployment
lives in a **separate, private config repo** (`andrasore/betpossum-prod`) that
layers your real host, image pins, and SOPS-encrypted Secrets onto this repo's
`overlays/prod`; Flux reconciles that private repo and pulls the reusable
manifests from *this* public repo read-only.

```
PUBLIC  andrasore/betpossum              PRIVATE  andrasore/betpossum-prod
  k8s/base/          (reusable)            clusters/prod/   Flux: sources, Kustomization, image-automation
  k8s/overlays/prod/ (generic example)     overlays/prod/   real host + SOPS secrets + image $pins
        ▲                                        │
        │  GitRepository .spec.include           │ Flux reconciles (pull) ──► cluster
        └── fromPath: k8s  toPath: upstream ─────┘ ImageUpdateAutomation commits resolved tags back
```

The private overlay lists `../../upstream/overlays/prod` as its base: Flux's
`GitRepository.spec.include` copies this repo's whole `k8s/` tree into the private
artifact under `upstream/`, so the public `overlays/prod` (and the `../../base` it
references) resolve locally. Only the private repo needs a credential — a
read-write deploy key `flux bootstrap` registers, also used to push tag bumps. The
public repo and the public `ghcr.io/andrasore/betpossum/*` packages are pulled
anonymously (no PAT, no `imagePullSecret`).

**What Flux gives back over a manual apply:** pinned semver tags (not `:latest`),
`git revert` in the private repo as rollback, and drift reconciliation — a manual
`kubectl edit` is corrected on the next interval.

### Prod prerequisites (beyond the shared ones)

- **A TLS certificate** for your domain, which the Ingress controller serves from
  the `betpossum-tls` Secret (sealed in step 3). Where the cert comes from is up
  to your deployment — your own CA, or an origin cert from whatever CDN / load
  balancer fronts the cluster. No in-cluster issuer is needed. To terminate TLS
  entirely upstream instead, drop the TLS patch in
  `overlays/prod/kustomization.yaml`.
- **DNS** for your domain pointed at the NGINX Ingress Controller's external IP
  (`kubectl -n nginx-ingress get svc nginx-ingress`) — or at whatever CDN / load
  balancer fronts it.
- The **Flux CLI** — `curl -s https://fluxcd.io/install.sh | sudo bash`, or
  `flux-bin` from the AUR.
- **SOPS + age** (`sops`, `age`) to encrypt the prod Secrets the private overlay
  carries. The age *private* key never goes in git — it is loaded as a cluster
  Secret that Flux's kustomize-controller decrypts with.
- A **GitHub PAT** with `repo` scope for `flux bootstrap` (one-time).

The rest of this section is the concrete setup for `betpossum-prod`, which ends up
laid out like this:

```
betpossum-prod/
  .sops.yaml
  clusters/prod/
    flux-system/            # created by `flux bootstrap`
    betpossum-source.yaml   # GitRepository → this public repo
    apps.yaml               # Kustomization (SOPS decryption)
    image-automation.yaml   # 7× ImageRepository/ImagePolicy + one ImageUpdateAutomation
  overlays/prod/
    kustomization.yaml      # base: ../../upstream/overlays/prod; image $pins; host patch
    secrets.enc.yaml        # SOPS-encrypted Secrets
```

### 1. age key + `.sops.yaml`

```bash
age-keygen -o age.agekey            # keep the PRIVATE key out of git
# note the "# public key: age1..." line it prints
git clone git@github.com:andrasore/betpossum-prod.git && cd betpossum-prod
mkdir -p clusters/prod overlays/prod
```

`.sops.yaml` (repo root) — encrypt only the Secret payloads, with your *public* key:

```yaml
creation_rules:
  - path_regex: overlays/prod/secrets\.enc\.yaml$
    encrypted_regex: '^(data|stringData)$'
    age: age1...        # your PUBLIC key from age-keygen
```

### 2. `overlays/prod/kustomization.yaml` — host + image pins

The thin real overlay: the public `overlays/prod` as base (via `include`, below),
plus the SOPS secrets, the image pins Flux writes, and your real domain. This is
also where the `base/` placeholders get filled in — the ConfigMap patch sets
`PUBLIC_HOST`/`KEYCLOAK_ISSUER_URL`, and the Ingress patch sets the host and TLS
host.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: betpossum
resources:
  - ../../upstream/overlays/prod   # public base+prod, pulled in via GitRepository .include
  - secrets.enc.yaml
images:                            # Flux writes resolved tags into the setters below
  - name: ghcr.io/andrasore/betpossum/core
    newTag: 0.1.0 # {"$imagepolicy": "flux-system:core:tag"}
  - name: ghcr.io/andrasore/betpossum/odds
    newTag: 0.1.0 # {"$imagepolicy": "flux-system:odds:tag"}
  - name: ghcr.io/andrasore/betpossum/notifications
    newTag: 0.1.0 # {"$imagepolicy": "flux-system:notifications:tag"}
  - name: ghcr.io/andrasore/betpossum/stats
    newTag: 0.1.0 # {"$imagepolicy": "flux-system:stats:tag"}
  - name: ghcr.io/andrasore/betpossum/frontend
    newTag: 0.1.0 # {"$imagepolicy": "flux-system:frontend:tag"}
  - name: ghcr.io/andrasore/betpossum/keycloak
    newTag: 0.1.0 # {"$imagepolicy": "flux-system:keycloak:tag"}
  - name: ghcr.io/andrasore/betpossum/bots
    newTag: 0.1.0 # {"$imagepolicy": "flux-system:bots:tag"}
patches:
  - patch: |-
      apiVersion: v1
      kind: ConfigMap
      metadata: { name: betpossum-config, namespace: betpossum }
      data:
        PUBLIC_HOST: <your-domain>
        KEYCLOAK_ISSUER_URL: https://<your-domain>/kc/realms/betting
  - target: { kind: Ingress, name: betpossum }
    patch: |-
      - op: replace
        path: /spec/rules/0/host
        value: <your-domain>
      - op: replace
        path: /spec/tls/0/hosts/0
        value: <your-domain>
```

Pin the seven `newTag`s to a published tag (`0.1.<run>`); find the newest with:

```bash
tok=$(curl -s "https://ghcr.io/token?scope=repository:andrasore/betpossum/core:pull&service=ghcr.io" | jq -r .token)
curl -s -H "Authorization: Bearer $tok" \
  https://ghcr.io/v2/andrasore/betpossum/core/tags/list | jq -r '.tags[]' | grep '^0\.'
```

### 3. `overlays/prod/secrets.enc.yaml`

Build the five Secrets — four passwords, each reused where it appears twice (a
connection URL the apps read, and the discrete var the server reads), so the copies
always match — then SOPS-encrypt in place:

```bash
gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; }
DB=$(gen); MQ=$(gen); KCDB=$(gen); KCADMIN=$(gen)
: "${CORE_CLIENT_SECRET:?betting-core client credential}"
{
  kubectl create secret generic betpossum-app-secrets -n betpossum \
    --from-literal=DATABASE_URL="postgresql://betting:${DB}@postgres:5432/betting" \
    --from-literal=RABBITMQ_URL="amqp://betting:${MQ}@rabbitmq:5672" \
    --from-literal=KEYCLOAK_ADMIN_CLIENT_SECRET="${CORE_CLIENT_SECRET}" \
    --from-literal=THE_ODDS_API_KEY="${THE_ODDS_API_KEY:-}" \
    --from-literal=APIFOOTBALL_API_KEY="${APIFOOTBALL_API_KEY:-}" --dry-run=client -o yaml
  echo ---
  kubectl create secret generic postgres-secret -n betpossum \
    --from-literal=POSTGRES_DB=betting --from-literal=POSTGRES_USER=betting \
    --from-literal=POSTGRES_PASSWORD="${DB}" --dry-run=client -o yaml
  echo ---
  kubectl create secret generic rabbitmq-secret -n betpossum \
    --from-literal=RABBITMQ_DEFAULT_USER=betting \
    --from-literal=RABBITMQ_DEFAULT_PASS="${MQ}" --dry-run=client -o yaml
  echo ---
  kubectl create secret generic keycloak-secret -n betpossum \
    --from-literal=KC_DB_PASSWORD="${KCDB}" --from-literal=KC_BOOTSTRAP_ADMIN_USERNAME=admin \
    --from-literal=KC_BOOTSTRAP_ADMIN_PASSWORD="${KCADMIN}" --dry-run=client -o yaml
  echo ---
  kubectl create secret tls betpossum-tls -n betpossum \
    --cert=tls.crt --key=tls.key --dry-run=client -o yaml
} > overlays/prod/secrets.enc.yaml
sops --encrypt --in-place overlays/prod/secrets.enc.yaml   # committing this is safe: private repo + encrypted
```

`KEYCLOAK_ADMIN_CLIENT_SECRET` is betting-core's confidential client secret
(Keycloak admin console → clients → betting-core → Credentials, or set it in
`realm.prod.json` first). `DB`/`MQ`/`KCDB` each appear where a connection URL the
apps read meets the discrete var the server reads, so the copies must match;
generating them from `[A-Za-z0-9]` avoids URL/SQL escaping. `KC_DB_PASSWORD` is the
single source for the `keycloak` DB role (`postgres-init` creates it, Keycloak
connects with it — one Postgres hosts both databases). `THE_ODDS_API_KEY` /
`APIFOOTBALL_API_KEY` only matter if `ODDS_PROVIDERS` names those providers.
`tls.crt`/`tls.key` are the cert + key for your domain (your own CA, or an origin
cert from whatever CDN / load balancer fronts the cluster); nothing renews them
in-cluster, so re-seal when you rotate.

### 4. `clusters/prod/` — the Flux resources

`betpossum-source.yaml` — this public repo, pulled anonymously:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata: { name: betpossum-source, namespace: flux-system }
spec:
  interval: 5m
  url: https://github.com/andrasore/betpossum
  ref: { branch: main }
```

`apps.yaml` — the Kustomization that reconciles the private overlay and decrypts
its Secrets:

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata: { name: betpossum, namespace: flux-system }
spec:
  interval: 5m
  retryInterval: 1m
  path: ./overlays/prod
  prune: true
  wait: true
  sourceRef: { kind: GitRepository, name: flux-system }   # the private repo (self)
  decryption:
    provider: sops
    secretRef: { name: sops-age }
  # Gate Ready on every Deployment that serves user requests: nginx (edge), core
  # (API), odds/stats/notifications (proxied under /odds, /stats, /socket.io), and
  # keycloak (auth under /kc). Only bots is left out — it is the synthetic
  # play-data generator, not on any request path, so a slow/failed bots rollout
  # must not hold back or fail the app's Ready status. (Postgres/RabbitMQ/
  # TigerBeetle are StatefulSets; the serving Deployments won't go Available
  # without them.)
  healthChecks:
    - { apiVersion: apps/v1, kind: Deployment, name: nginx, namespace: betpossum }
    - { apiVersion: apps/v1, kind: Deployment, name: core, namespace: betpossum }
    - { apiVersion: apps/v1, kind: Deployment, name: odds, namespace: betpossum }
    - { apiVersion: apps/v1, kind: Deployment, name: stats, namespace: betpossum }
    - { apiVersion: apps/v1, kind: Deployment, name: notifications, namespace: betpossum }
    - { apiVersion: apps/v1, kind: Deployment, name: keycloak, namespace: betpossum }
```

`image-automation.yaml` — one `ImageRepository` + `ImagePolicy` per image (7:
core, odds, notifications, stats, frontend, keycloak, bots), and one shared
`ImageUpdateAutomation` that commits resolved tags back to this private repo.
Pattern per image, then the updater:

```yaml
apiVersion: image.toolkit.fluxcd.io/v1
kind: ImageRepository
metadata: { name: core, namespace: flux-system }
spec:
  image: ghcr.io/andrasore/betpossum/core
  interval: 5m            # public package — no secretRef
---
apiVersion: image.toolkit.fluxcd.io/v1
kind: ImagePolicy
metadata: { name: core, namespace: flux-system }
spec:
  imageRepositoryRef: { name: core }
  policy: { semver: { range: '>=0.1.0' } }
---
# ... repeat the pair for odds, notifications, stats, frontend, keycloak, bots ...
---
apiVersion: image.toolkit.fluxcd.io/v1
kind: ImageUpdateAutomation
metadata: { name: betpossum, namespace: flux-system }
spec:
  interval: 5m
  sourceRef: { kind: GitRepository, name: flux-system }
  git:
    checkout: { ref: { branch: main } }
    commit:
      author: { name: fluxcdbot, email: fluxcdbot@users.noreply.github.com }
      messageTemplate: 'chore(deploy): update image tags'
    push: { branch: main }
  update: { path: ./overlays/prod, strategy: Setters }
```

**How "newest" is decided.** The CI promote job stamps every e2e-validated image
with `0.1.<run number>` (see [`pr.yml`](../.github/workflows/pr.yml)); an
`ImagePolicy` with `semver.range: '>=0.1.0'` selects the highest. `run_number` is
monotonic and never resets, so a higher patch is always a newer build. The git sha
is deliberately absent from the tag (docker forbids the `+` of semver build
metadata, and a `-<sha7>` suffix would sort as a *prerelease*, before the plain
version); the `:<sha>` staging tag on the same digest carries that mapping, as
does CI run `#<run number>`.

### 5. keycloak-realm ConfigMap (prod)

The realm is imported on first boot and must carry the right URLs. Kustomize
cannot generate it from a file outside the overlay directory, so create it out of
band. Copy `realm.json` to `realm.prod.json` first and change the
`betting-frontend` client to your domain — `redirectUris`
`https://<domain>/auth/callback` (+ `/silent`), `webOrigins` `https://<domain>`,
`post.logout.redirect.uris` `https://<domain>/*` — then:

```bash
kubectl create namespace betpossum
kubectl -n betpossum create configmap keycloak-realm \
  --from-file=realm.json=keycloak/realm.prod.json
```

> `--import-realm` only imports a realm that doesn't already exist. To change the
> realm after first boot, edit it via the Keycloak admin API/console, or drop the
> `keycloak` database in the shared Postgres (wiping the postgres PVC would also
> destroy app data, since one Postgres hosts both databases).

### 6. Bootstrap Flux

```bash
export GITHUB_TOKEN=<PAT with repo scope>
flux bootstrap github \
  --owner=andrasore --repository=betpossum-prod --private --personal \
  --branch=main \
  --path=clusters/prod \
  --components-extra=image-reflector-controller,image-automation-controller

# age private key so the cluster can decrypt the SOPS secrets:
kubectl -n flux-system create secret generic sops-age --from-file=age.agekey=age.agekey
```

`--branch=main` points bootstrap at the branch you already populated in steps 1–5
rather than a fresh one — the repo and branch exist, so bootstrap reconciles into
them (adds `clusters/prod/flux-system/`, commits, pushes) instead of creating them.

Bootstrap commits `clusters/prod/flux-system/` and registers a read-write deploy
key. Add the `.spec.include` block to the generated `GitRepository` (in
`clusters/prod/flux-system/gotk-sync.yaml`), so it copies this repo's `k8s/` tree
into the artifact under `upstream/`:

```yaml
  include:
    - repository: { name: betpossum-source }
      fromPath: k8s
      toPath: upstream
```

Commit everything (the files from steps 1–5 plus this edit) and push.

### 7. Verify

```bash
flux check
flux get sources git             # flux-system + betpossum-source → Ready
flux get kustomizations          # betpossum → Ready (SOPS decrypt succeeded)
flux get images all              # 7 policies resolve to the latest 0.1.<run>
kubectl -n betpossum get deploy -o wide   # IMAGES show the pinned tag, not :latest
```

Within an interval the `ImageUpdateAutomation` commits a tag bump to
`betpossum-prod`; `git revert` that commit and Flux rolls the cluster back. Then
point your domain's DNS at the NGINX Ingress Controller's external IP — the
controller serves the sealed cert from `betpossum-tls` for the domain.

## Observability (optional)

A Helm-based metrics + logs platform — kube-prometheus-stack (Prometheus +
Grafana + Alertmanager), Loki (log store), and Alloy (log collector) — installs
into a separate `observability` namespace, independent of the `kubectl apply -k`
app deploy. Grafana gets its own Ingress on the same NGINX controller
(`grafana.localhost` locally, `grafana.<domain>` + TLS in prod). See
[`observability/README.md`](observability/README.md) for the install commands and
verification steps.

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
