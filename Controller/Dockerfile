### === Stage 1: Build GUI === ###
FROM node:23-bookworm AS gui-builder

ARG path="Configuration GUI"
WORKDIR /app

# Install dependencies (cacheable)
COPY ${path}/package.json ./
COPY ${path}/package-lock.json ./
RUN npm install

# Copy remaining GUI source files
COPY ${path}/public ./public
COPY ${path}/src ./src
COPY ${path}/tsconfig.json .

# Build GUI
RUN npm run build


### === Stage 2: Build Controller === ###
FROM rust:1.84-bookworm AS controller-builder

ARG path="Controller"
WORKDIR /app

# Install required system dependencies early (one layer)
RUN apt update && \
    apt install -y libstdc++6 libgomp1 cmake libclang-dev

# Cache Rust dependencies
COPY ${path}/Cargo.toml .
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release || true  # Pre-cache dependencies

# Copy actual Rust source
COPY ${path}/src ./src

# Copy GUI build output into Rust project if needed
COPY --from=gui-builder /app/build ./gui_build

# Build Rust app
RUN cargo build --release


### === Stage 3: Runtime Image === ###
FROM debian:bookworm

WORKDIR /app

# Copy the compiled binary from the builder
COPY --from=controller-builder /app/target/release/p4tg-controller /app

# Entrypoint for the app with logging
ENTRYPOINT ["/bin/bash", "-c", "RUST_LOG=none,p4tg_controller=info,rbfrt=info /app/p4tg-controller"]
