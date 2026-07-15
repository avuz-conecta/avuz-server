/**
 * @typedef {Object} PeerResult
 * @property {string} name
 * @property {boolean} joined
 * @property {boolean} ice
 * @property {number} remote
 * @property {string[]} errors
 */

const toInt = (value, fallback) => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new Error(`expected integer, got "${value}"`);
  return parsed;
};

export const parseConfig = (env) => {
  const talkUrl = env.TALK_URL;
  if (!talkUrl) throw new Error("TALK_URL is required (public conversation link)");
  const guests = toInt(env.GUESTS, 25);
  return {
    talkUrl,
    guests,
    holdSeconds: toInt(env.HOLD_SECONDS, 300),
    staggerMs: toInt(env.STAGGER_MS, 500),
    namePrefix: env.NAME_PREFIX ?? "LoadTest",
    nameOffset: toInt(env.NAME_OFFSET, 0),
    nameTotal: toInt(env.NAME_TOTAL, guests),
    navTimeoutMs: toInt(env.NAV_TIMEOUT_MS, 60000),
    joinTimeoutMs: toInt(env.JOIN_TIMEOUT_MS, 45000),
    headful: env.HEADFUL === "1",
  };
};
