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

## Continuous delivery (Keel)

The steps above are a one-shot manual deploy. [Keel](https://keel.sh) closes the
loop on the image half: it runs **in the cluster**, polls GHCR, and patches newer
image tags onto the Deployments. It pulls, so nothing needs inbound access to the
cluster, and it never touches this repo — no deploy key, no PAT, and no bot
commits on a public repo.

```
CI promote ──► GHCR :0.1.<run>
                     │  Keel polls every 5m
                     ▼
              Keel (in-cluster) ──patch──► Deployment tag ──► rollout
```

**Scope: images only.** Keel updates image tags and nothing else. Every other
manifest change — replicas, env, Ingress, secrets — is still `kubectl apply -k
k8s/overlays/prod` by hand. That is the trade for not running GitOps: no
controller reconciles git onto the cluster, so nothing detects or corrects drift.

**How "newest" is decided.** The CI promote job stamps every e2e-validated image
with `0.1.<run number>` (see [`pr.yml`](../.github/workflows/pr.yml)). Keel parses
that as semver and compares it against the tag on the live Deployment, so a higher
run number is always a newer release — `run_number` is monotonic and never resets.
The `keel.sh/policy: major` annotation in `overlays/prod` means "accept any newer
semver"; it is not limited to major bumps.

The git sha is deliberately **not** in the release tag: a docker tag cannot carry
semver build metadata (`+` is illegal), and a `-<sha7>` suffix would make the tag
a *prerelease*, which sorts before the plain version and inverts the ordering. To
map a release back to a commit, open CI run `#<run number>` in the Actions UI; the
`:<sha>` staging tag on the same digest carries the same mapping.

### CD prerequisites (beyond the deploy prereqs above)

**Helm**, and nothing else. The `ghcr.io/andrasore/betpossum/*` packages are
public, so Keel polls them anonymously — no `imagePullSecret`, no `read:packages`
PAT.

### 1. Pin a tag that actually exists

`overlays/prod/kustomization.yaml` ships `newTag: 0.1.0` as a placeholder, and
**that tag does not exist** — applying it as-is lands the pods in
`ImagePullBackOff`. Keel needs a real semver on the Deployment to compare against,
so set the six tags to a published one first. All six images get the same tag from
a single promote step, so one value covers them all:

```bash
tok=$(curl -s "https://ghcr.io/token?scope=repository:andrasore/betpossum/core:pull&service=ghcr.io" | jq -r .token)
curl -s -H "Authorization: Bearer $tok" \
  https://ghcr.io/v2/andrasore/betpossum/core/tags/list | jq -r '.tags[]' | grep '^0\.'
```

### 2. Install Keel

```bash
helm repo add keel https://charts.keel.sh && helm repo update
helm install keel keel/keel -n keel --create-namespace
```

### 3. Apply and verify

```bash
kubectl apply -k k8s/overlays/prod

kubectl -n keel logs deploy/keel -f   # poll decisions land here
# what is actually running (Keel edits the live object, so this drifts from git):
kubectl -n betpossum get deploy -o wide   # IMAGES column
```

### What you give up

- **Re-applying the overlay rolls the cluster backwards.** Keel writes the new tag
  onto the live Deployment; git still holds the old one. `kubectl apply -k`
  re-asserts git, so an unrelated manifest change reverts *every* image to the
  pinned tag until Keel's next poll (≤5m) rolls it forward again. If the pinned
  tag has since been deleted from GHCR, that window is an `ImagePullBackOff`
  instead. Refresh the `newTag` values when they drift far behind.
- **Rollback is a cluster operation, not `git revert`.** `kubectl rollout undo` or
  `kubectl set image` only hold until Keel's next poll rolls them forward again.
  Keel has no "pause" policy, so a deliberate pin means dropping the annotation
  first and restoring it afterwards:

  ```bash
  kubectl -n betpossum annotate deploy/core keel.sh/policy-      # Keel lets go
  kubectl -n betpossum set image deploy/core core=ghcr.io/andrasore/betpossum/core:0.1.41
  kubectl -n betpossum annotate deploy/core keel.sh/policy=major # hand it back
  ```
- **Secrets are manual.** Flux's kustomize-controller was the only thing
  decrypting SOPS in-cluster, so `.sops.yaml` went with it.
  `overlays/prod/secrets.yaml` keeps its `CHANGE_ME` placeholders — same posture
  as the `keycloak-realm` ConfigMap. Note that it is a *tracked* file on a public
  repo and the overlay lists it under `resources`, so it must exist for
  `kustomize build`: either keep real values out of git
  (`git update-index --skip-worktree`) or drop it from `resources` and create the
  Secret out of band with `kubectl create secret`.
- **No drift detection.** Nothing reconciles the cluster back to git, so a manual
  `kubectl edit` sticks until someone re-applies.
- **Keel does not manage its own upgrades** — that is `helm upgrade`.

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
