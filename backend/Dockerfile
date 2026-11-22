FROM golang:1.27.4-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
ARG SOURCE_URL
ARG REVISION
RUN CGO_ENABLED=0 go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/levelboard-backend .

FROM alpine:3.23
ARG SOURCE_URL
ARG REVISION
RUN adduser -D -H -u 10001 levelboard \
    && mkdir -p /data \
    && chown levelboard:levelboard /data
COPY --from=build /out/levelboard-backend /usr/local/bin/levelboard-backend
USER levelboard
ENV LEVELBOARD_ADDR=0.0.0.0:8081
ENV LEVELBOARD_DB=/data/levelboard.db
ENV LEVELBOARD_COMMIT=${REVISION}
EXPOSE 8081
LABEL org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.title="levelboard-backend"
ENTRYPOINT ["/usr/local/bin/levelboard-backend"]
