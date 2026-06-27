#!/usr/bin/env bash
# On-demand local GitLab CE + docker-executor runner, for the runner-gated CI
# seam tests (GITLAB_RUNNER_TEST_*). Ephemeral (no volumes) — a throwaway rig.
#
#   scripts/local_gitlab.sh up     # boot GitLab + runner, print the test env
#   scripts/local_gitlab.sh down   # tear it all down
#   scripts/local_gitlab.sh env    # re-print the test env (mints a fresh PAT)
#
# Reproduces, as one command, the manual setup: network -> gitlab-ce -> wait
# healthy -> root PAT -> instance runner -> register (docker executor) -> allow
# local webhooks. Requires Docker. Runs in git-bash (MSYS_NO_PATHCONV guards the
# docker-socket mount path).
set -euo pipefail

NET=gitlab-net
URL=http://localhost:8929
EXTURL=http://host.docker.internal:8929
ROOT_PW=HaikaiLocal2026!
IMG=gitlab/gitlab-ce:latest
RUNNER_IMG=gitlab/gitlab-runner:latest

_pat() {  # mint a fresh root PAT via the rails console
  docker exec gitlab gitlab-rails runner \
    "u=User.find_by_username('root'); t=u.personal_access_tokens.create!(scopes:['api','read_repository','write_repository'], name:'haikai-automation-'+Time.now.to_i.to_s, expires_at:365.days.from_now); puts 'PAT='+t.token" \
    2>/dev/null | sed -n 's/^PAT=//p'
}

up() {
  docker network create "$NET" 2>/dev/null || true
  echo "booting gitlab-ce (this takes ~3-5 min)..."
  docker rm -f gitlab 2>/dev/null || true
  docker run -d --name gitlab --network "$NET" --hostname gitlab \
    --add-host host.docker.internal:host-gateway \
    -p 8929:8929 -p 2224:22 --shm-size 256m \
    -e GITLAB_OMNIBUS_CONFIG="external_url '$EXTURL'; gitlab_rails['initial_root_password']='$ROOT_PW'; puma['worker_processes']=2; prometheus_monitoring['enable']=false;" \
    "$IMG" >/dev/null
  printf "waiting for HTTP"
  for _ in $(seq 1 90); do
    code=$(curl -s -o /tmp/_gl.txt -w "%{http_code}" "$URL/users/sign_in" 2>/dev/null || echo 000)
    [ "$code" = "200" ] && { echo " ready"; break; }
    printf "."; sleep 10
  done
  PAT=$(_pat)
  echo "minting runner token + registering..."
  RT=$(curl -s --request POST --header "PRIVATE-TOKEN: $PAT" \
        "$URL/api/v4/user/runners" --data "runner_type=instance_type" \
        --data "description=local-docker" --data "run_untagged=true" --data "tag_list=docker,local" \
        | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  docker rm -f gitlab-runner 2>/dev/null || true
  MSYS_NO_PATHCONV=1 docker run -d --name gitlab-runner --network "$NET" \
    --add-host host.docker.internal:host-gateway \
    -v /var/run/docker.sock:/var/run/docker.sock "$RUNNER_IMG" >/dev/null
  MSYS_NO_PATHCONV=1 docker exec gitlab-runner gitlab-runner register --non-interactive \
    --url "$EXTURL" --token "$RT" --executor docker --docker-image "alpine:latest" \
    --docker-extra-hosts "host.docker.internal:host-gateway" --docker-network-mode "$NET" >/dev/null
  # allow webhooks to local addresses (SSRF guard off) — needed for the B5 webhook path
  curl -s --request PUT --header "PRIVATE-TOKEN: $PAT" \
    "$URL/api/v4/application/settings?allow_local_requests_from_web_hooks_and_services=true" >/dev/null
  echo "--- READY. Test env: ---"
  echo "export GITLAB_RUNNER_TEST_URL=$URL"
  echo "export GITLAB_RUNNER_TEST_TOKEN=$PAT"
  echo "UI: $URL   (root / $ROOT_PW)"
}

down() {
  docker rm -f gitlab gitlab-runner 2>/dev/null || true
  docker network rm "$NET" 2>/dev/null || true
  echo "torn down."
}

env_() {  # re-print env against an already-running instance
  PAT=$(_pat)
  echo "export GITLAB_RUNNER_TEST_URL=$URL"
  echo "export GITLAB_RUNNER_TEST_TOKEN=$PAT"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  env) env_ ;;
  *) echo "usage: $0 {up|down|env}"; exit 2 ;;
esac
