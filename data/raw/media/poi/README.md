# v0.4.4 POI media provenance

This folder contains one local JPEG rendition for each of the 40 planner POIs.
The original 10 featured records remain identified by
`site/data/featured-pois-v0.4.json`; the complete runtime manifest is
`site/data/poi-media-v0.4.4.json`, and the 30-item expansion plus two featured
replacements is pinned in `data/curation/poi-media-v0.4.4.json`.

The files were downloaded from Wikimedia Commons as renditions with a longest
edge of at most 1280 pixels. Matching web copies live under `site/public/poi/`;
the prototype does not hot-link them. Each new runtime record preserves the
Commons title and file page, author, licence, original URL, source dimensions
and SHA-1, local SHA-256, match evidence, attribution, and display treatment.

All 40 images were reviewed together as centered 4:3 thumbnails. They show the
intended Melbourne venue, landmark, park feature, or venue interior. Any later
re-sync resets new records to pending review until
`node scripts/sync-poi-media.mjs --mark-reviewed` is run after another visual
check.
