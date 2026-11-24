#!/usr/bin/env bash
# Called on the VPS by GitHub Actions; all paths except the staged WAR are fixed.
set -euo pipefail

app_dir=/opt/apps/deliveryya
container=deliveryya
image=tomcat:11.0-jdk21-temurin
war=${1:?Pass the path to the staged WAR}

command -v docker >/dev/null
command -v curl >/dev/null
[[ -s "$war" ]] || { echo 'Staged WAR is missing or empty' >&2; exit 1; }
[[ -d "$app_dir/uploads" && -w "$app_dir" ]] || { echo "Prepare $app_dir and its uploads directory first" >&2; exit 1; }

# Prepare everything possible before stopping the current container.
docker pull "$image"
cp "$war" "$app_dir/app.war.next"
if [[ -f "$app_dir/app.war" ]]; then
  cp "$app_dir/app.war" "$app_dir/app.war.previous"
fi
if docker container inspect "$container" >/dev/null 2>&1; then
  docker stop "$container"
  docker rm "$container"
fi
mv -f "$app_dir/app.war.next" "$app_dir/app.war"

docker run -d --name "$container" --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -e UPLOAD_PATH=/uploads \
  -v "$app_dir/app.war:/usr/local/tomcat/webapps/ROOT.war:ro" \
  -v "$app_dir/uploads:/uploads" \
  -p 127.0.0.1:8082:8080 \
  "$image"

# Spring Security returns 401 for an unauthenticated request once the app has
# initialized. A listening Tomcat alone is not enough to indicate success.
for ((attempt=1; attempt<=60; attempt++)); do
  if [[ "$(docker inspect -f '{{.State.Running}}' "$container")" != true ]]; then
    break
  fi
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8082/api/v1/__deployment_probe__ || true)
  if [[ "$status" == 401 ]]; then
    echo 'Deliveryya started and responded to the deployment probe.'
    exit 0
  fi
  sleep 2
done

echo 'Deployment did not become ready; inspect docker logs. The previous WAR, if any, is at app.war.previous.' >&2
exit 1
