const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const config = require("./config");

async function registerCommands() {
  if (!config.discordToken) throw new Error("DISCORD_TOKEN ontbreekt in je environment.");
  if (!config.clientId) throw new Error("DISCORD_CLIENT_ID ontbreekt in je environment.");
  if (!config.guildId) throw new Error("DISCORD_GUILD_ID ontbreekt in je environment.");

  const command = new SlashCommandBuilder()
    .setName("remind-unregistered")
    .setDescription("DM leden die nog niet zijn ingeschreven voor CWL.")
    .addBooleanOption((option) =>
      option
        .setName("dry_run")
        .setDescription("Alleen controleren en een rapport maken, zonder DM's te sturen.")
        .setRequired(true)
    )
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("ClashPerk Excel export met het tabblad Missing members.")
        .setRequired(true)
    )
    .addAttachmentOption((option) =>
      option
        .setName("member_file")
        .setDescription("Optioneel ledenbestand met Player Tags en Discord User IDs.")
        .setRequired(false)
    );

  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: [command.toJSON()]
  });

  console.log("Slash command geregistreerd voor deze Discord-server.");
}

if (require.main === module) {
  registerCommands().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  registerCommands
};
