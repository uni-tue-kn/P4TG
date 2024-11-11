FROM rust:1.77-bookworm
RUN mkdir /app
WORKDIR /app
COPY ./src /app/src
COPY ./Cargo.toml /app
COPY ./gui_build /app/gui_build
RUN apt update
RUN apt install -y libstdc++6 libgomp1 cmake libclang-dev
RUN cargo build --release
RUN cp target/release/p4tg-controller /app
ENTRYPOINT ["/bin/bash", "-c", "RUST_LOG=none,p4tg_controller=info,rbfrt=info /app/p4tg-controller"]

