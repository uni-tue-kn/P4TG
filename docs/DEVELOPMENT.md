# Development
This file contains instructions on development of the P4TG components.

## Data Plane

For local testing of data plane changes, you can use the following docker image to compile the data plane on your local machine. This is much faster that compiling on the Tofino itself.

```yaml
version: '3.8'
services:
  p4compiler:
    image: fihle/open-p4studio:9.13.4
    volumes:
      - .:/workspace
    working_dir: /workspace
    command: sudo -E /open-p4studio/install/bin/bf-p4c -D__TARGET_TOFINO__=1 --target tofino -g --arch tna -o /opt/traffic_gen traffic_gen.p4
    environment:
      SDE: /open-p4studio
      SDE_INSTALL: /open-p4studio/install
```
Place this `docker-compose.yaml` file in `P4-Implementation` and run `docker compose up` to compile it locally.

## Control Plane

Start the controller with `RUST_LOG=info cargo run` from inside the `Controller` folder. The controller communicates via `localhost` and the gRPC port (default: 50052) with the data plane.

## Configuration GUI

The configuration GUI is automatically served by the controller at http://*ip-of-tofino-controller*:`P4TG_PORT` and is included in the prebuilt docker image.
If you want to make changes, either:
- Re-build the configuration GUI via `npm install && npm start` within the `Configuration GUI` folder and restart the controller
- Adapt the `API_URL` in the `config.ts` to run the controller and configuration GUI independently. Run the frontend with `npm run start`.

## Build the Docker Image Locally

If you want to build the docker image locally, use the following command from inside the repository root: `docker build --file Controller/Dockerfile --no-cache -t unituekn/p4tg-controller:test .`
This will automatically build and copy the configuration GUI into the controller folder and create an image containing the modifications.







