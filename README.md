# Heads Up

A personal news briefing for Windows: top news, local news and weather, politics, social media, Claude and AI news, Counter-Strike 2 patch notes and esports, and topics you follow, in one window.

## Install it (Windows)

1. Install **[Node.js](https://nodejs.org/en/download)** (the LTS version) if you don't have it. It's free.
2. **[Download Heads Up](https://github.com/THATLMG/heads-up/archive/refs/heads/main.zip)** and unzip it.
3. Double-click **Install Heads Up** in the unzipped folder. If Windows asks whether to run it, choose **More info → Run anyway**.

Heads Up opens in its own window and puts a shortcut on your Desktop and in the Start menu. It updates itself from here, so you never need to download it again.

Your account (username, scrambled password, and your news settings) is stored only on your computer, in `%APPDATA%\Heads Up`.

## How it works

The installed app lives in `Documents\Heads Up`. It's a single page (`app/app.html`) served by a small Node.js helper (`app/server.js`) that fetches the news feeds, keeps accounts for the people who use it on that computer, and updates the app from this repository.

## Announcements

Every copy of Heads Up reads `announcements.json` here and shows new announcements as a banner and in the notification bell. The owner sends them from the megaphone button in the app (it only appears on the computer that has this repository at `~/heads-up`), or by editing that file on GitHub.

## How updates work

The helper checks `app/version.json` here when Heads Up opens and every 30 minutes while it's open. If its `version` is higher than the installed one, it downloads every file in `files`, swaps them in, and the app shows a reload banner.

## Releasing a new version

1. Change the files in `app/`.
2. Raise the version by one in **both** `app/version.json` (`"version"`) and `app/app.html` (`const APP_VERSION`), and describe the change in `"notes"`.
3. Commit and push to `main`. Installed copies pick it up the next time they open (GitHub can take a few minutes to serve the new files).
