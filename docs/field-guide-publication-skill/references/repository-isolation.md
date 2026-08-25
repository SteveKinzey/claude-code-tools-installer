# Repository isolation checklist

Use `docs/<guide-name>/` for the static site, its local assets, and downloadable PDF. Do not place documentation assets beside installer scripts or release archives unless the user explicitly requests a software release asset.

Before committing, confirm all changed paths stay under the intended documentation directory. Confirm static assets contain no environment-managed storage URLs. Confirm the copied PDF is the reviewed source. Remove local preview caches and untracked build artifacts.

Stage only the documentation directory. Check the staged path list before committing. If any installer script, runtime file, package manifest, credential file, or release artifact appears, unstage it and stop for review.
