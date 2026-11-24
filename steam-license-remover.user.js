// ==UserScript==
// @name         Steam License Auto-Remover Pro (Turbo + Auto-Cooldown)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Löscht kostenlose Steam-Lizenzen so schnell wie möglich mit automatischem Rate-Limit-Cooldown und Live-Overlay.
// @match        *://store.steampowered.com/account/licenses*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Geschwindigkeit & Cooldown-Konfiguration
    const FAST_DELAY_MS = 1500;                  // 1,5 Sek. zwischen Löschungen im Burst
    const FIRST_COOLDOWN_MS = 15 * 60 * 1000;    // 15 Min. erste Pause bei Rate-Limit
    const RETRY_COOLDOWN_MS = 10 * 60 * 1000;    // 10 Min. weitere Pausen, bis Limit frei ist
    const NETWORK_RETRY_MS = 60 * 1000;          // 1 Min. Pause bei kurzem Verbindungsabbruch

    // Deine geschützte Whitelist
    const whitelist = [
        "3DMark", "Aperture Desk Job", "Apex Legends", "ARK: Survival Evolved", "ARK: Survival Of The Fittest",
        "Assetto Corsa", "Assetto Corsa Competizione", "Assetto Corsa EVO", "ASTRONEER", "Aviassembly",
        "Battlefield 1", "Battlefield 2042", "Battlefield V", "Bloons TD 6", "Bodycam", "Call of Duty",
        "CarX Drift Racing Online", "Cities: Skylines", "Cookie Clicker", "Counter-Strike", "Counter-Strike 2",
        "Counter-Strike: Condition Zero", "Counter-Strike: Source", "Crosshair X", "Day of Defeat",
        "Day of Defeat: Source", "Deadlock", "Deathmatch Classic", "Digseum", "DOOM", "DOOM Eternal",
        "Euro Truck Simulator", "Euro Truck Simulator 2", "Far Cry", "Far Cry 2", "Far Cry 3", "Far Cry 4",
        "Far Cry 5", "Farming Simulator 22", "Forza Horizon 4", "Forza Horizon 5", "Forza Horizon 6",
        "FPS Chess", "Grand Theft Auto IV", "Grand Theft Auto V", "Half-Life",
        "Halo: The Master Chief Collection", "HerrAnwalt: Lawyers Legacy", "Horsey Game",
        "Landwirtschafts-Simulator 22", "Left 4 Dead", "Left 4 Dead 2", "Max Payne 2", "Max Payne 3",
        "Mini Motorways", "Muck", "My Summer Car", "My Winter Car", "Need for Speed", "One Million Coins",
        "One-armed cook", "Overwatch", "Papers, Please", "POLYGON", "Portal", "Portal 2", "Portal with RTX",
        "Realm Royale", "Red Dead Redemption 2", "Ricochet", "Satisfactory", "Scania Truck Driving Simulator",
        "Schedule I", "Steam Engine Simulator", "SUPERHOT", "Team Fortress Classic", "Team Fortress 2",
        "Terraria", "The Lab", "Tom Clancy's Rainbow Six Siege", "Totally Accurate Battlegrounds",
        "Trackmania", "Wallpaper Engine", "War Thunder", "Wolfenstein: Cyberpilot",
        "Wolfenstein: The New Order", "Wolfenstein: The Old Blood"
    ];

    const normalizeText = str => str.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedWhitelist = whitelist.map(normalizeText);

    // Statusvariablen
    let licensesToRemove = [];
    let currentIndex = 0;
    let deletedCount = 0;
    let skippedErrors = 0;
    let consecutiveRateLimits = 0;
    let isPaused = false;
    let isFinished = false;
    let actionTimer = null;
    let countdownTimer = null;
    let nextRunTime = 0;
    let remainingMs = 0;

    // UI-Elemente
    let hudStatus, hudProgress, hudTimer, hudBtn;

    function createHUD() {
        const box = document.createElement('div');
        box.style.cssText = [
            'position:fixed', 'top:16px', 'right:16px', 'z-index:99999',
            'background:#1b2838', 'color:#c7d5e0', 'border:1px solid #66c0f4',
            'border-radius:6px', 'padding:12px 14px', 'width:260px',
            'font-family:Arial,sans-serif', 'font-size:13px', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)'
        ].join(';');

        box.innerHTML = `
            <div style="font-weight:bold;color:#66c0f4;margin-bottom:6px;">Steam License Turbo-Remover</div>
            <div id="slr-progress" style="margin-bottom:4px;">Initialisiere...</div>
            <div id="slr-status" style="margin-bottom:4px;color:#a4d007;">Warte auf Start...</div>
            <div id="slr-timer" style="margin-bottom:10px;font-size:12px;color:#8f98a0;">–</div>
            <button id="slr-toggle" style="width:100%;padding:6px;background:#2a475e;color:#fff;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">Pause</button>
        `;
        document.body.appendChild(box);

        hudProgress = document.getElementById('slr-progress');
        hudStatus = document.getElementById('slr-status');
        hudTimer = document.getElementById('slr-timer');
        hudBtn = document.getElementById('slr-toggle');

        hudBtn.addEventListener('click', togglePause);
    }

    function formatTime(ms) {
        const totalSec = Math.max(0, Math.ceil(ms / 1000));
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    function updateHUD(statusText, color = '#a4d007') {
        if (!hudProgress) return;
        hudProgress.textContent = `Gelöscht: ${deletedCount} / ${licensesToRemove.length}` + (skippedErrors ? ` (Fehler: ${skippedErrors})` : '');
        hudStatus.textContent = statusText;
        hudStatus.style.color = color;
    }

    function clearTimers() {
        if (actionTimer) clearTimeout(actionTimer);
        if (countdownTimer) clearInterval(countdownTimer);
        actionTimer = null;
        countdownTimer = null;
    }

    function togglePause() {
        if (isFinished) return;

        if (!isPaused) {
            isPaused = true;
            remainingMs = Math.max(0, nextRunTime - Date.now());
            clearTimers();
            hudBtn.textContent = 'Fortsetzen';
            hudBtn.style.background = '#5c7e10';
            updateHUD('Pausiert', '#f0ad4e');
            hudTimer.textContent = 'Pausiert';
        } else {
            isPaused = false;
            hudBtn.textContent = 'Pause';
            hudBtn.style.background = '#2a475e';
            scheduleNext(remainingMs > 0 ? remainingMs : 500, 'Setze fort...');
        }
    }

    function scheduleNext(delayMs, statusText, color = '#a4d007') {
        clearTimers();
        if (isPaused) {
            remainingMs = delayMs;
            updateHUD('Pausiert', '#f0ad4e');
            return;
        }

        nextRunTime = Date.now() + delayMs;
        updateHUD(statusText, color);
        hudTimer.textContent = `Nächste Aktion in: ${formatTime(delayMs)}`;

        if (delayMs >= 5000) {
            countdownTimer = setInterval(() => {
                const left = nextRunTime - Date.now();
                hudTimer.textContent = `Nächste Aktion in: ${formatTime(left)}`;
                if (left <= 0) clearInterval(countdownTimer);
            }, 1000);
        }

        actionTimer = setTimeout(() => {
            clearTimers();
            removeNext();
        }, delayMs);
    }

    function handleRateLimit(item, reason) {
        consecutiveRateLimits++;
        const waitMs = consecutiveRateLimits === 1 ? FIRST_COOLDOWN_MS : RETRY_COOLDOWN_MS;
        console.warn(`⏳ Rate-Limit (${reason}) bei "${item.name}". Cooldown #${consecutiveRateLimits}: ${waitMs / 60000} Min.`);
        scheduleNext(waitMs, `Rate-Limit (${reason}) – Cooldown`, '#f0ad4e');
    }

    function stopWithError(msg) {
        clearTimers();
        isFinished = true;
        hudBtn.disabled = true;
        hudBtn.style.opacity = '0.5';
        updateHUD(msg, '#ff5c5c');
        hudTimer.textContent = 'Seite neu laden zum Fortsetzen';
        console.error('❌ ' + msg);
    }

    function removeNext() {
        if (isPaused || isFinished) return;

        if (currentIndex >= licensesToRemove.length) {
            isFinished = true;
            clearTimers();
            hudBtn.textContent = 'Fertig';
            hudBtn.disabled = true;
            updateHUD('Alle Lizenzen abgearbeitet!', '#66c0f4');
            hudTimer.textContent = 'Abgeschlossen';
            console.log('🎉 Fertig! Alle ausgewählten Lizenzen wurden abgearbeitet.');
            return;
        }

        const item = licensesToRemove[currentIndex];
        updateHUD(`Lösche: ${item.name.slice(0, 26)}...`, '#66c0f4');

        jQuery.ajax({
            url: 'https://store.steampowered.com/account/removelicense',
            type: 'POST',
            dataType: 'json',
            timeout: 15000,
            data: {
                sessionid: g_sessionID,
                packageid: item.packageId
            },
            success: function (data) {
                if (data && data.success === 1) {
                    consecutiveRateLimits = 0;
                    deletedCount++;
                    console.log(`✅ [${deletedCount}/${licensesToRemove.length}] Entfernt: ${item.name} (ID: ${item.packageId})`);
                    item.row.remove();
                    currentIndex++;
                    if (currentIndex < licensesToRemove.length) {
                        scheduleNext(FAST_DELAY_MS, 'Burst-Modus aktiv');
                    } else {
                        removeNext();
                    }
                } else if (data && data.success === 84) {
                    handleRateLimit(item, 'Code 84');
                } else if (data && (data.success === 21 || data.success === 15)) {
                    stopWithError('Steam-Session abgelaufen (neu einloggen).');
                } else {
                    const code = data ? data.success : 'unbekannt';
                    console.error(`⚠️ Abgelehnt: "${item.name}" (Code: ${code}). Überspringe.`);
                    item.row.style.backgroundColor = 'rgba(255, 80, 80, 0.25)';
                    skippedErrors++;
                    currentIndex++;
                    scheduleNext(FAST_DELAY_MS, `Übersprungen (Code ${code})`, '#ff5c5c');
                }
            },
            error: function (xhr) {
                if (xhr.status === 429) {
                    handleRateLimit(item, 'HTTP 429');
                } else if (xhr.status === 401 || xhr.status === 403) {
                    stopWithError(`Session/Auth-Fehler (HTTP ${xhr.status}).`);
                } else if (xhr.status === 0) {
                    console.warn(`🌐 Netzwerkfehler/Timeout bei "${item.name}". Neuer Versuch in 1 Min.`);
                    scheduleNext(NETWORK_RETRY_MS, 'Netzwerkfehler – Retry', '#f0ad4e');
                } else {
                    console.error(`❌ HTTP ${xhr.status} bei "${item.name}". Überspringe.`);
                    item.row.style.backgroundColor = 'rgba(255, 80, 80, 0.25)';
                    skippedErrors++;
                    currentIndex++;
                    scheduleNext(FAST_DELAY_MS, `HTTP ${xhr.status} – Übersprungen`, '#ff5c5c');
                }
            }
        });
    }

    function startProcess() {
        if (typeof jQuery === 'undefined' || typeof g_sessionID === 'undefined') {
            console.error('❌ Steam-Umgebung (jQuery / g_sessionID) nicht gefunden.');
            return;
        }

        createHUD();

        const freeLicenseLinks = document.querySelectorAll('.free_license_remove_link a');
        freeLicenseLinks.forEach(el => {
            const row = el.closest('tr');
            if (!row) return;

            const titleCell = row.cells[1] || row;
            const cleanName = titleCell.innerText.replace(/Entfernen|Remove/gi, '').trim();
            const normalizedName = normalizeText(cleanName);

            if (!normalizedWhitelist.some(w => normalizedName.includes(w))) {
                const match = el.href.match(/RemoveFreeLicense\(\s*(\d+)/);
                if (match) {
                    licensesToRemove.push({
                        packageId: match[1],
                        name: cleanName.split('\n')[0],
                        row: row
                    });
                }
            }
        });

        if (licensesToRemove.length === 0) {
            isFinished = true;
            hudBtn.disabled = true;
            updateHUD('Keine löschbaren Lizenzen gefunden.', '#66c0f4');
            hudTimer.textContent = 'Fertig';
            return;
        }

        console.log(`🚀 Starte Turbo-Löschvorgang für ${licensesToRemove.length} Lizenzen.`);
        removeNext();
    }

    setTimeout(startProcess, 2000);
})();
