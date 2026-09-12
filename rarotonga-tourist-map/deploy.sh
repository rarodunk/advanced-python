#!/usr/bin/env bash
# Build every page and push the result straight to Netlify from this machine.
# Use this when you have not connected the repository to Netlify, or when you
# want to publish something you have not committed yet.
#
#     ./deploy.sh              # deploy to production
#     ./deploy.sh --draft      # a preview URL instead
set -euo pipefail
cd "$(dirname "$0")"

# a folder-served copy links the card art instead of carrying it inline
RARO_LINK_ASSETS=1 python3 build_all.py
python3 tools/make_site.py

if [ "${1:-}" = "--draft" ]; then
  npx --yes netlify-cli deploy --dir dist
else
  npx --yes netlify-cli deploy --prod --dir dist
fi
