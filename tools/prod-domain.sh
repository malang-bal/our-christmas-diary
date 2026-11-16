#!/bin/bash
# 운영 주소(waiting-for-christmas.web.app)에 맞춰 로그인 허용 도메인 · API 키 · Storage CORS 설정 (한 번만 실행)
set -e
P=our-christmas-diary-prod
T=$(gcloud auth print-access-token)
H=(-H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "Content-Type: application/json")
echo "== 로그인 허용 도메인"
curl -s -X PATCH "${H[@]}" "https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config?updateMask=authorizedDomains" \
  -d '{"authorizedDomains":["our-christmas-diary-prod.firebaseapp.com","our-christmas-diary-prod.web.app","waiting-for-christmas.web.app","waiting-for-christmas.firebaseapp.com"]}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin).get("authorizedDomains"))'
echo "== API 키 웹사이트 제한"
K=$(gcloud services api-keys list --project $P --filter='displayName~Browser' --format='value(name)' | head -1)
gcloud services api-keys update "$K" --project $P --quiet \
  --allowed-referrers='https://waiting-for-christmas.web.app/*,https://waiting-for-christmas.firebaseapp.com/*,https://our-christmas-diary-prod.web.app/*,https://our-christmas-diary-prod.firebaseapp.com/*' >/dev/null 2>&1
gcloud services api-keys describe "$K" --project $P --format='value(restrictions.browserKeyRestrictions.allowedReferrers)'
echo "== Storage CORS"
gcloud storage buckets update gs://$P.firebasestorage.app --cors-file=cors.json >/dev/null 2>&1
gcloud storage buckets describe gs://$P.firebasestorage.app --format='value(cors_config)'
echo "== 끝"
