FROM node:24-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    curl -fsSL https://github.com/zeroclaw-labs/zeroclaw/releases/download/v0.8.2/zeroclaw-x86_64-unknown-linux-gnu.tar.gz | tar xz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/zeroclaw && \
    mkdir -p /zeroclaw-data && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV ZEROCLAW_DATA_DIR=/zeroclaw-data
EXPOSE 42617

ENTRYPOINT ["zeroclaw"]
CMD ["serve"]
