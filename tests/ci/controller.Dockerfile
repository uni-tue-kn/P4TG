FROM rust:1.91-bookworm AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake libclang-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build/Controller
COPY Controller/Cargo.toml ./
COPY Controller/src ./src
COPY Controller/gui_build ./gui_build
RUN cargo build --release -j 8

WORKDIR /build/tests
COPY tests/Cargo.toml ./
COPY tests/common ./common
RUN cargo check -j 8

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/Controller/target/release/p4tg-controller ./p4tg-controller
ENTRYPOINT ["/app/p4tg-controller"]
