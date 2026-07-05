FROM ghcr.io/zeroclaw-labs/zeroclaw:latest
ENV ZEROCLAW_DATA_DIR=/data
ENV ZEROCLAW_GATEWAY_PORT=8080
EXPOSE 8080
VOLUME ["/data"]
