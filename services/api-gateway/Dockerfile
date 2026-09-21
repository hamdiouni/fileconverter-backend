# API Gateway — Nginx (build context: backend root)
FROM nginx:1.25-alpine

RUN apk add --no-cache wget curl && rm /etc/nginx/conf.d/default.conf

COPY services/api-gateway/nginx.conf /etc/nginx/nginx.conf
COPY services/api-gateway/conf.d/    /etc/nginx/conf.d/

EXPOSE 80 443

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
