import { chromium } from "playwright";
import { parseConfig } from "./config.mjs";
import { guestName } from "./naming.mjs";
import { joinAndHold } from "./peer.mjs";
import { formatReport } from "./report.mjs";

const FAKE_MEDIA_FLAGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
];

// Talk rejects "HeadlessChrome" as unsupported; present as regular Chrome.
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const config = parseConfig(process.env);
  console.log(
    `Launching ${config.guests} guests -> ${config.talkUrl} ` +
      `(hold ${config.holdSeconds}s, stagger ${config.staggerMs}ms, headful=${config.headful})`,
  );
  console.log(`Joins stream below; full report after the ${config.holdSeconds}s hold.\n`);

  const browser = await chromium.launch({
    headless: !config.headful,
    args: FAKE_MEDIA_FLAGS,
  });

  const tasks = [];
  for (let index = 0; index < config.guests; index += 1) {
    const name = guestName(config.namePrefix, config.nameOffset + index, config.nameTotal);
    const context = await browser.newContext({ userAgent: CHROME_USER_AGENT });
    tasks.push(joinAndHold(context, config, name));
    if (index < config.guests - 1) await sleep(config.staggerMs);
  }

  const results = await Promise.all(tasks);
  await browser.close();

  console.log(`\n=== Talk HPB load-test report ===\n${formatReport(results)}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
