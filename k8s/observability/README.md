# Observability

A self-contained metrics + logs platform for the BetPossum cluster, installed
with Helm (committed values files) into its own `observability` namespace —
separate from the app, which keeps using `kubectl apply -k`.

| Component             | Chart                                                 | What it does                                                                                           |
|-----------------------|-------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| kube-prometheus-stack | `prometheus-community/kube-prometheus-stack` (87.2.1) | Prometheus (cluster/infra metrics: node-exporter, kube-state-metrics, cAdvisor), Alertmanager, Grafana |
| Loki                  | `grafana/loki` (7.0.0)                                | Log store — SingleBinary + filesystem PVC                                                              |
| Alloy                 | `grafana/alloy` (1.10.0)                              | DaemonSet collector — tails every pod's logs → Loki                                                    |

Scope is platform-only. The app services (core/odds/notifications/stats) do
not expose `/metrics` yet, so there are no app-level metrics or ServiceMonitors —
this is the infra-metrics + log-aggregation + dashboards foundation. Prometheus
is pre-configured (`serviceMonitorSelectorNilUsesHelmValues: false`) to pick up
any ServiceMonitors added later, in any namespace.

## Layout

```
k8s/observability/
  kube-prometheus-stack.values.yaml        # shared: Prometheus/Alertmanager/Grafana + Loki datasource
  kube-prometheus-stack.local.values.yaml  # Grafana Ingress: grafana.localhost, no TLS
  kube-prometheus-stack.prod.values.yaml   # Grafana Ingress: grafana.<domain> + cert-manager TLS
  loki.values.yaml                         # SingleBinary + filesystem
  alloy.values.yaml                        # DaemonSet + log-collection config
```

The Grafana Ingress is the only per-environment difference (host + TLS) — the
same local↔prod delta the app's `base/50-ingress.yaml` already has.

## Install

```bash
# 1. Chart repos
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# 2. Metrics + Grafana (pick the env file: .local or .prod)
helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  -n observability --create-namespace --version 87.2.1 \
  -f k8s/observability/kube-prometheus-stack.values.yaml \
  -f k8s/observability/kube-prometheus-stack.local.values.yaml

# 3. Loki (log store)
helm upgrade --install loki grafana/loki \
  -n observability --create-namespace --version 7.0.0 \
  -f k8s/observability/loki.values.yaml

# 4. Alloy (log collector)
helm upgrade --install alloy grafana/alloy \
  -n observability --create-namespace --version 1.10.0 \
  -f k8s/observability/alloy.values.yaml

kubectl -n observability rollout status deploy/kube-prometheus-stack-grafana
kubectl -n observability get pods
```

Persistence (Grafana, Prometheus, Alertmanager, Loki) needs the cluster's
default StorageClass — already a prereq for the app (k3s ships `local-path`).

For prod, swap step 2's env file for `kube-prometheus-stack.prod.values.yaml`
and first fill in its `CHANGE_ME`s (Grafana admin password + the `grafana.<domain>`
host, which must match the TLS host). It reuses the `letsencrypt-prod`
ClusterIssuer from `../overlays/prod/cluster-issuer.yaml`.

## Reach it

- **Grafana**
  - local: <http://grafana.localhost:8080> — served through the same NGINX-Inc
    controller that fronts the app on host `:8080` (routed by `Host` header).
    `.localhost` resolves to loopback in modern browsers; otherwise add
    `127.0.0.1 grafana.localhost` to `/etc/hosts`. Login `admin` /
    `betting_dev` (the committed dev password).
  - prod: `https://grafana.<domain>` once DNS points at the controller and
    cert-manager has issued `grafana-tls`.
- **Prometheus / Alertmanager** — operational, not exposed; use port-forward:
  ```bash
  kubectl -n observability port-forward svc/kube-prometheus-stack-prometheus 9090
  kubectl -n observability port-forward svc/kube-prometheus-stack-alertmanager 9093
  ```

## Verify

- **Metrics:** Prometheus `:9090` → Status → Targets are green (node-exporter,
  kube-state-metrics, kubelet/cAdvisor).
- **Logs:** Grafana → Explore → Loki datasource → `{namespace="betpossum"}`.
  Place a bet in the app to generate fresh core/notifications log lines and watch
  them land.
- **Datasources:** Grafana → Connections → both Prometheus and Loki show
  "working".

## Production note

Loki here uses a filesystem PVC (single binary). That's fine for local/demo
but not durable HA — a real production deployment should run Loki in scalable
mode backed by object storage (S3/GCS/MinIO). Likewise Prometheus/Alertmanager
here are single-replica with modest retention (7d).
