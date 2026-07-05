FROM alpine:3.19

RUN apk add --no-cache ca-certificates curl libgcc && \
    curl -fsSL -o /tmp/zeroclaw.tar.gz \
      https://github.com/zeroclaw-labs/zeroclaw/releases/download/v0.8.2/zeroclaw-x86_64-unknown-linux-musl.tar.gz && \
    tar xzf /tmp/zeroclaw.tar.gz -C /usr/local/bin/ && \
    rm /tmp/zeroclaw.tar.gz && \
    chmod +x /usr/local/bin/zeroclaw && \
    mkdir -p /zeroclaw-data

ENV ZEROCLAW_DATA_DIR=/zeroclaw-data
EXPOSE 42617

ENTRYPOINT ["/usr/local/bin/zeroclaw"]
CMD ["serve"]
