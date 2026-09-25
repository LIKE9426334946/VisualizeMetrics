#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/VisualizeMetrics
if [[ "$EUID" -ne 0 ]]; then
  echo '请使用 root 用户执行。' >&2
  exit 1
fi
cd "$APP_DIR"
npm ci
npm run build
install -m 644 deploy/VisualizeMetrics.service /etc/systemd/system/VisualizeMetrics.service
install -m 644 deploy/VisualizeMetrics.nginx /etc/nginx/sites-available/VisualizeMetrics
ln -sfn /etc/nginx/sites-available/VisualizeMetrics /etc/nginx/sites-enabled/VisualizeMetrics
nginx -t
systemctl daemon-reload
systemctl enable VisualizeMetrics
systemctl restart VisualizeMetrics
systemctl enable nginx
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl start nginx
fi
systemctl --no-pager --full status VisualizeMetrics
