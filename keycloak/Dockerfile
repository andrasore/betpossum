FROM quay.io/keycloak/keycloak:26.0 AS builder
ENV KC_DB=postgres
# http-relative-path is a *build-time* option: it must be baked here so the
# `start --optimized` image serves under /kc (nginx fronts Keycloak there).
# Setting it only at runtime is ignored and makes the optimized server refuse
# to start.
ENV KC_HTTP_RELATIVE_PATH=/kc
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.0
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY themes/betpossum /opt/keycloak/themes/betpossum
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
