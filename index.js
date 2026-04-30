require("dotenv").config();

const DEFAULT_MESSAGE =
  "Hoi [Username],\n\n" +
  "Wij zien dat je nog niet bent ingeschreven voor de Clan War League deze maand in Bruutgeweld!. We zijn deze maand begonnen met inschrijven i.p.v. standaard meedoen, dus even een persoonlijk bericht in het geval dat dit niet duidelijk was/of niet hebt meegekregen. Dit zullen wij in de toekomst blijven doen.\n\n" +
  "Dit bericht is geautomatiseerd, er waren veel mensen die bericht moesten worden, vraag in de server aan een co-leider als je hulp nodig hebt.";

function readList(name, fallback = "") {
  return (process.env[name] || fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  discordToken: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || "951865015126851584",
  allowedRoleIds: readList("ALLOWED_ROLE_IDS"),
  allowedRoleNames: readList(
    "ALLOWED_ROLE_NAMES",
    "admins,co leider [BG1],co leider [BGX]"
  ).map((name) => name.toLowerCase()),
  reminderMessage: (process.env.REMINDER_MESSAGE || DEFAULT_MESSAGE).replace(/\\n/g, "\n"),
  dmDelayMs: readInt("DM_DELAY_MS", 2500),
  maxDmsPerRun: readInt("MAX_DMS_PER_RUN", 100),
  registerCommandsOnStart: process.env.REGISTER_COMMANDS_ON_START !== "false"
};
