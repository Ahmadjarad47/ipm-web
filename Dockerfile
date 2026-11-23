# IPM web image: the Angular app built once, served by nginx, which also forwards /api to the API on the same origin
# (so the refresh cookie is first-party and no CORS is needed). Build context = this repository root.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist/ipm-web/browser /usr/share/nginx/html
# The API address is a variable of the container (default: the "api" service of docker-compose).
ENV API_UPSTREAM=http://api:8080
EXPOSE 80
