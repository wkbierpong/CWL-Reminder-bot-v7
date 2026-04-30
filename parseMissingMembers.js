const {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags
} = require("discord.js");
const config = require("./config");
const {
  applyMemberMapping,
  parseMemberMappingWorkbook,
  parseMissingMembersWorkbook
} = require("./parseMissingMembers");
const { buildReminderMessage } = require("./reminderMessage");
const { registerCommands } = require("./register-commands");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasAllowedRole(interaction) {
  if (!interaction.guild || !interaction.member) return false;

  const rawRoles = interaction.member.roles;
  const memberRoleIds = Array.isArray(rawRoles) ? rawRoles : [...rawRoles.cache.keys()];

  if (config.allowedRoleIds.length > 0) {
    const allowedIds = new Set(config.allowedRoleIds);
    if (memberRoleIds.some((roleId) => allowedIds.has(roleId))) return true;
  }

  if (config.allowedRoleNames.length > 0) {
    return memberRoleIds.some((roleId) => {
      const role = interaction.guild.roles.cache.get(roleId);
      return role && config.allowedRoleNames.includes(role.name.toLowerCase());
    });
  }

  return false;
}

async function downloadAttachment(attachment) {
  const filename = attachment.name || "";
  if (!filename.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Upload een Excel-bestand met .xlsx als extensie.");
  }

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Ik kon het Excel-bestand niet downloaden (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function formatMember(member) {
  const name = member.playerName || "Onbekende speler";
  const tag = member.playerTag ? ` (${member.playerTag})` : "";
  const clan = member.clan ? ` - ${member.clan}` : "";
  const discord = member.discordId ? `<@${member.discordId}>` : member.discord || "geen Discord ID";
  const source = member.discordSource ? ` [${member.discordSource}]` : "";
  const issue = member.mappingIssue ? ` | ${member.mappingIssue}` : "";
  return `${name}${tag}${clan} -> ${discord}${source}${issue}`;
}

function buildReport({ dryRun, parsed, mappingUsed, sendResults }) {
  const lines = [];
  lines.push(`CWL reminder rapport`);
  lines.push(`Modus: ${dryRun ? "dry-run, geen DM's verstuurd" : "DM's verstuurd"}`);
  lines.push(`Tabblad: ${parsed.sheetName}`);
  lines.push(`Aantal regels in Missing members: ${parsed.members.length}`);
  if (mappingUsed) {
    lines.push(`Ledenbestand gebruikt: ja (${parsed.mapping.totalRows} bruikbare Discord-koppelingen)`);
    lines.push(`Dubbele spelernamen in ledenbestand genegeerd: ${parsed.mapping.duplicateNameCount}`);
  } else {
    lines.push(`Ledenbestand gebruikt: nee`);
  }
  lines.push("");

  if (dryRun) {
    const withId = parsed.members.filter((member) => member.discordId);
    const withoutId = parsed.members.filter((member) => !member.discordId);

    lines.push(`Kan DM'en: ${withId.length}`);
    lines.push(`Geen Discord User ID gevonden: ${withoutId.length}`);
    lines.push("");
    lines.push("Zouden een DM krijgen:");
    lines.push(...withId.map(formatMember));

    if (withoutId.length > 0) {
      lines.push("");
      lines.push("Overgeslagen omdat Discord User ID ontbreekt:");
      lines.push(...withoutId.map(formatMember));
    }
  } else {
    lines.push(`Verzonden: ${sendResults.sent.length}`);
    lines.push(`Mislukt: ${sendResults.failed.length}`);
    lines.push(`Overgeslagen: ${sendResults.skipped.length}`);
    lines.push("");

    if (sendResults.sent.length > 0) {
      lines.push("Verzonden:");
      lines.push(...sendResults.sent.map((result) => formatMember(result.member)));
      lines.push("");
    }

    if (sendResults.failed.length > 0) {
      lines.push("Mislukt:");
      lines.push(
        ...sendResults.failed.map((result) => `${formatMember(result.member)} | ${result.reason}`)
      );
      lines.push("");
    }

    if (sendResults.skipped.length > 0) {
      lines.push("Overgeslagen:");
      lines.push(
        ...sendResults.skipped.map((result) => `${formatMember(result.member)} | ${result.reason}`)
      );
    }
  }

  return lines.join("\n");
}

async function sendReminders(client, parsed) {
  const sendableMembers = parsed.members.filter((member) => member.discordId);
  const skipped = parsed.members
    .filter((member) => !member.discordId)
    .map((member) => ({ member, reason: "Geen Discord User ID gevonden." }));

  const membersToSend = sendableMembers.slice(0, config.maxDmsPerRun);
  const capped = sendableMembers.slice(config.maxDmsPerRun).map((member) => ({
    member,
    reason: `Niet verstuurd door MAX_DMS_PER_RUN=${config.maxDmsPerRun}.`
  }));

  const sent = [];
  const failed = [];

  for (const member of membersToSend) {
    try {
      const user = await client.users.fetch(member.discordId);
      const message = buildReminderMessage(config.reminderMessage, member, user);
      await user.send(message);
      sent.push({ member });
    } catch (error) {
      failed.push({
        member,
        reason: error?.message || "Onbekende fout bij DM versturen."
      });
    }

    await sleep(config.dmDelayMs);
  }

  return {
    sent,
    failed,
    skipped: [...skipped, ...capped]
  };
}

async function handleRemindUnregistered(interaction, client) {
  if (interaction.guildId !== config.guildId) {
    await interaction.reply({
      content: "Deze command is alleen ingesteld voor jullie eigen server.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!hasAllowedRole(interaction)) {
    await interaction.reply({
      content: "Je hebt geen toegestane beheerrol voor deze command.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const dryRun = interaction.options.getBoolean("dry_run", true);
  const attachment = interaction.options.getAttachment("file", true);
  const memberAttachment = interaction.options.getAttachment("member_file", false);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const buffer = await downloadAttachment(attachment);
  const parsed = parseMissingMembersWorkbook(buffer);
  let mappingUsed = false;

  if (memberAttachment) {
    const memberBuffer = await downloadAttachment(memberAttachment);
    const mapping = parseMemberMappingWorkbook(memberBuffer);

    if (mapping.rows.length === 0) {
      throw new Error(
        "Ik kon geen bruikbare Discord-koppelingen vinden in het ledenbestand. Ik heb minimaal een speler-tag of spelernaam plus Discord User ID/mention nodig."
      );
    }

    applyMemberMapping(parsed, mapping);
    mappingUsed = true;
  }

  let sendResults = null;
  if (!dryRun) {
    sendResults = await sendReminders(client, parsed);
  }

  const report = buildReport({ dryRun, parsed, mappingUsed, sendResults });
  const reportFile = new AttachmentBuilder(Buffer.from(report, "utf8"), {
    name: dryRun ? "cwl-reminder-dry-run.txt" : "cwl-reminder-resultaat.txt"
  });

  const sendableCount = parsed.members.filter((member) => member.discordId).length;
  const summary = dryRun
    ? `Dry-run klaar. Ik vond ${parsed.members.length} regels in Missing members; ${sendableCount} daarvan hebben een Discord User ID.`
    : `Klaar. Verzonden: ${sendResults.sent.length}, mislukt: ${sendResults.failed.length}, overgeslagen: ${sendResults.skipped.length}.`;

  await interaction.editReply({
    content: summary,
    files: [reportFile]
  });
}

if (!config.discordToken) {
  throw new Error("DISCORD_TOKEN ontbreekt in je environment.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ingelogd als ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "remind-unregistered") return;

  try {
    await handleRemindUnregistered(interaction, client);
  } catch (error) {
    const message = error?.message || "Er ging iets mis.";

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: `Fout: ${message}`, files: [] });
    } else {
      await interaction.reply({ content: `Fout: ${message}`, flags: MessageFlags.Ephemeral });
    }
  }
});

async function main() {
  if (config.registerCommandsOnStart) {
    await registerCommands();
  }

  await client.login(config.discordToken);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
