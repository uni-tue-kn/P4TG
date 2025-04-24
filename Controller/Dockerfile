FROM node:23-bookworm AS gui-builder
ARG path="/Configuration GUI"
WORKDIR /app
COPY ${path}/public ./public
COPY ${path}/src ./src
COPY ${path}/package.json .
COPY ${path}/tsconfig.json .
RUN npm install
RUN npm run build

FROM rust:1.84-bookworm AS controller-builder
ARG path="/Controller"
WORKDIR /app
COPY ${path}/src ./src
COPY ${path}/Cargo.toml .
COPY --from=gui-builder /app/build ./gui_build
RUN apt update
RUN apt install -y libstdc++6 libgomp1 cmake libclang-dev
RUN RUSTFLAGS="--cfg tokio_unstable" cargo build --release

FROM debian:bookworm
WORKDIR /app
COPY --from=controller-builder /app/target/release/p4tg-controller /app
ENTRYPOINT ["/bin/bash", "-c", "RUST_LOG=none,p4tg_controller=info,rbfrt=info /app/p4tg-controller"]