FROM rust:1.99-bookworm AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake libclang-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build/Controller
COPY Controller/Cargo.toml Controller/Cargo.lock ./
COPY Controller/src ./src
COPY Controller/gui_build ./gui_build
RUN cargo build --release --locked -j 8

WORKDIR /build/tests
COPY tests/Cargo.toml ./
COPY tests/Cargo.lock ./
COPY tests/common ./common
COPY tests/api ./api
COPY tests/regression ./regression
COPY tests/model ./model
RUN --mount=type=cache,id=p4tg-ci-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=p4tg-ci-tests-target,target=/build/tests/target,sharing=locked \
    cargo build --release --bin p4tg-model-tests -j 8 \
 && cp target/release/p4tg-model-tests /build/p4tg-model-tests

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/Controller/target/release/p4tg-controller ./p4tg-controller
COPY --from=builder /build/p4tg-model-tests ./p4tg-model-tests
ENTRYPOINT ["/app/p4tg-controller"]
