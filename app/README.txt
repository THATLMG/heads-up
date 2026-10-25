HEADS UP
========

Open it: double-click "Heads Up" on your desktop (or in the Start menu).
It opens in its own window and loads your news, weather, CS2 updates and more.

How it works
- "server.js" is a small helper that runs in the background while Heads Up is open.
  It fetches the news feeds, because a web page can't read other sites by itself.
- It only runs on your computer (nothing else on your network can reach it), only reads
  Google News, Steam, HLTV and wttr.in, and closes itself about 20 minutes after you
  close the window.
- It needs Node.js, which is already installed on this PC.

Updates
- Heads Up updates itself. Each time it opens (and every 30 minutes while open) the helper
  checks github.com/THATLMG/heads-up for a newer version, downloads it and swaps it in.
  When that happens the app shows "Heads Up has been updated" with a Reload link.
- Your location, topics and saved stories are kept through updates.
- If a download fails halfway, nothing is changed and it tries again next time.

What's different from the Claude app version
- Email: the Claude app version can show your unread Gmail. This version has a button
  that opens Gmail instead.
- Explain, "What matters today" and "Summary of the last 3 days" use Claude, so they
  only work in the Claude app version.

Files
- app.html     the app itself
- server.js    the helper
- Heads Up.vbs starts the helper (hidden) and opens the window
- icon.png / heads-up.ico   the app icon

To remove it: delete this folder and the "Heads Up" shortcuts.
