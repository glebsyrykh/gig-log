FROM golang:1.25-alpine AS builder

WORKDIR /build
COPY backend/go.mod ./
COPY backend/*.go ./
RUN go mod tidy && CGO_ENABLED=0 go build -o /giglog-server .

FROM alpine:3.20
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /giglog-server .
COPY db/ ./db/
EXPOSE 8080
CMD ["./giglog-server"]
