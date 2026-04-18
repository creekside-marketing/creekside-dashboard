# Contractor Guide: Editing Client Reports

When a client report needs editing, open Claude, say what you want, done.

---

## How to edit a client's report

1. Open Claude in the creekside brain folder (same way you always do).

2. Tell Claude exactly what you want changed. Use this pattern:

   *"Edit [client name]'s [google or meta] report to [what you want changed]."*

   Example:

   *"Edit Aura Displays' Google report, change the Cost per Conversion card color to red."*

3. Wait for Claude's confirmation. It will tell you when the change is done and when it will show up on the dashboard.

That's it. You never need to open a file, never touch a terminal, never deal with GitHub.

---

## If Claude asks you a question

If your request is ambiguous, Claude will ask one clarifying question. Answer it and Claude keeps going. Example: you ask to change "the card color" and Claude asks which card you mean. Just reply.

---

## If Claude says the client isn't branched yet

Some clients need to be set up before you can customize their report. If Claude tells you a client "isn't branched yet," send Peterson a message in Google Chat:

*"Client [name] isn't branched yet, can you run branch-report?"*

Wait for Peterson to confirm it's done, then ask Claude for the edit again.

---

## When your change doesn't appear on the dashboard

After Claude confirms it's done, the dashboard takes about 2 minutes to update. Refresh the report page after 2 or 3 minutes and your change should be there.

If it's still not showing after 5 minutes, screenshot both the report page and Claude's confirmation message, and send them to Peterson in Google Chat.

---

## What you should NOT do

- Don't edit files directly in VS Code, Cursor, or any other editor. Always go through Claude.
- Don't try to run commands in a terminal. Claude handles everything for you.
- Don't ask Claude to edit the default report templates (files with names like `LeadGenGoogleReport.tsx`). Those aren't for client-specific changes. If Claude refuses to edit a file, or you hear that a change was rejected, that's why. Ping Peterson and he'll sort it out.

---

## Getting help

If anything feels off, an error message you don't recognize, a confirmation that never comes, a change that never shows up, screenshot what you're seeing and message Peterson in Google Chat. Don't try to fix it yourself. It's always faster to ask than to guess.
