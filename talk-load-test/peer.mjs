// Selectors for current Nextcloud Talk guest-join UI (verified vs app3.avuz.app,
// pt_BR). Edit only this block if the UI/locale drifts.
const SELECTOR = {
  guestNameInput:
    'input[placeholder*="Convidado" i], input[placeholder*="Nome de exibição" i], input[placeholder*="Guest" i], input[placeholder*="name" i]',
  joinCall:
    '[role="dialog"] button[aria-label*="Entrar na chamada" i], [role="dialog"] button:has-text("Entrar na chamada"), [role="dialog"] button[aria-label*="Join call" i], [role="dialog"] button:has-text("Join call")',
};

// Non-fatal console noise from Talk that does not affect joining a call.
const IGNORED_ERROR = [
  /fonts\.googleapis\.com.*Content Security Policy/i,
  /MediaPipe Tasks initialization failed/i,
  /didLoadFail/i,
];

const isNoise = (text) => IGNORED_ERROR.some((re) => re.test(text));

const readRtcStats = async (page) => {
  return page.evaluate(async () => {
    const pcs = (window.__loadTestPCs ??= []);
    let connected = false;
    let remote = 0;
    for (const pc of pcs) {
      if (pc.iceConnectionState === "connected" || pc.connectionState === "connected") {
        connected = true;
      }
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") remote += 1;
      });
    }
    return { connected, remote };
  });
};

const installPcHook = async (context) => {
  // Capture every RTCPeerConnection the page creates so we can read stats later.
  await context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    if (!Native || window.__loadTestPCs) return;
    window.__loadTestPCs = [];
    window.RTCPeerConnection = function (...args) {
      const pc = new Native(...args);
      window.__loadTestPCs.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = Native.prototype;
  });
};

/**
 * Drive one guest: join, publish A/V, hold, sample stats.
 * @returns {Promise<import("./config.mjs").PeerResult>}
 */
export const joinAndHold = async (context, config, name) => {
  /** @type {string[]} */
  const errors = [];
  await installPcHook(context);
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isNoise(msg.text())) errors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    if (!isNoise(err.message)) errors.push(err.message);
  });

  let joined = false;
  try {
    await page.goto(config.talkUrl, { waitUntil: "domcontentloaded", timeout: config.navTimeoutMs });

    const nameInput = page.locator(SELECTOR.guestNameInput).first();
    await nameInput.waitFor({ timeout: config.navTimeoutMs });
    await nameInput.fill(name);

    const joinButton = page.locator(SELECTOR.joinCall).first();
    await joinButton.click({ timeout: config.joinTimeoutMs });
    // In-call once the device-check modal closes and the join button detaches.
    await joinButton.waitFor({ state: "hidden", timeout: config.joinTimeoutMs });
    joined = true;
  } catch (err) {
    errors.push(`join-failed: ${err.message}`);
  }

  const stamp = new Date().toISOString().slice(11, 19);
  const lastError = errors[errors.length - 1] ?? "";
  console.log(`[${stamp}] ${name} ${joined ? "joined" : `JOIN-FAILED ${lastError}`}`);

  // Hold, sampling stats once at the midpoint.
  const holdMs = config.holdSeconds * 1000;
  await page.waitForTimeout(Math.floor(holdMs / 2));
  const mid = joined
    ? await readRtcStats(page).catch(() => ({ connected: false, remote: 0 }))
    : { connected: false, remote: 0 };
  await page.waitForTimeout(Math.ceil(holdMs / 2));

  await page.close().catch(() => {});
  return { name, joined, ice: mid.connected, remote: mid.remote, errors };
};
