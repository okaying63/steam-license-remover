# steam-license-remover
Tampermonkey userscript to automatically remove free Steam licenses with whitelist protection, adaptive rate-limit cooldowns, and a live status HUD.

# Steam License Auto-Remover Pro

A Tampermonkey userscript that automatically removes unwanted free licenses from your Steam account as fast as Steam's rate limits allow.

## Features
- **Whitelist Protection:** Safely skips specified games (with automatic normalization of `™`, `®`, and `©` symbols).
- **Turbo Mode & Adaptive Cooldown:** Removes licenses in fast bursts and automatically pauses when hitting Steam rate limits (`Code 84` / `HTTP 429`), resuming once the cooldown clears.
- **Live HUD:** Compact on-page overlay showing progress, countdown timer, and a Pause/Resume button.
- **Session Safety:** Automatically stops if the Steam session expires.

## Usage
1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the raw `.user.js` file in this repository to install the script.
3. Edit the `whitelist` array in the script to keep your preferred games.
4. Visit `https://store.steampowered.com/account/licenses/` — the script starts automatically.
