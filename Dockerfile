FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://github.com/zeroclaw-labs/zeroclaw/releases/download/v0.8.2/zeroclaw-x86_64-unknown-linux-gnu.tar.gz | \
    tar xz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/zeroclaw

RUN mkdir -p /zeroclaw-data

ENV ZEROCLAW_DATA_DIR=/zeroclaw-data
EXPOSE 42617

ENTRYPOINT ["zeroclaw"]
CMD ["serve"]
