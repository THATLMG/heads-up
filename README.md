# Heads Up

A personal news briefing for Windows: top news, local news and weather, politics, social media, Claude and AI news, Counter-Strike 2 patch notes and esports, and topics you follow, in one window.

The installed app lives in `Documents\Heads Up`. It's a single page (`app/app.html`) served by a small Node.js helper (`app/server.js`) that fetches the news feeds and updates the app from this repository.

## How updates work

The helper checks `app/version.json` here when Heads Up opens and every 30 minutes while it's open. If its `version` is higher than the installed one, it downloads every file in `files`, swaps them in, and the app shows a reload banner.

## Releasing a new version

1. Change the files in `app/`.
2. Raise the version by one in **both** `app/version.json` (`"version"`) and `app/app.html` (`const APP_VERSION`), and describe the change in `"notes"`.
3. Commit and push to `main`. Installed copies pick it up the next time they open (GitHub can take a few minutes to serve the new files).
