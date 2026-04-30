const XLSX = require("xlsx");

const SHEET_NAME = "Missing members";

const COLUMN_ALIASES = {
  playerName: ["playername", "name", "membername", "ingamename", "spelernaam", "player"],
  playerTag: ["playertag", "tag", "membertag", "spelertag", "playertags"],
  discord: [
    "discord",
    "discordid",
    "discorduserid",
    "discorduser",
    "discordusername",
    "discordname",
    "discordmention",
    "user",
    "userid",
    "id"
  ],
  clan: ["clan", "clanname"],
  clanTag: ["clantag"]
};

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findMissingSheetName(workbook) {
  const exact = workbook.SheetNames.find((name) => normalize(name) === normalize(SHEET_NAME));
  if (exact) return exact;

  return workbook.SheetNames.find((name) => {
    const normalized = normalize(name);
    return normalized.includes("missing") && normalized.includes("member");
  });
}

function scoreHeaderRow(cells) {
  const normalizedCells = cells.map(normalize).filter(Boolean);
  let score = 0;

  for (const names of Object.values(COLUMN_ALIASES)) {
    if (normalizedCells.some((cell) => names.includes(cell))) score += 1;
  }

  if (normalizedCells.some((cell) => cell.includes("discord"))) score += 2;
  if (normalizedCells.some((cell) => cell.includes("player") || cell.includes("member"))) score += 1;

  return score;
}

function findHeaderRow(matrix) {
  let best = { index: -1, score: 0 };
  const scanLimit = Math.min(matrix.length, 25);

  for (let index = 0; index < scanLimit; index += 1) {
    const score = scoreHeaderRow(matrix[index] || []);
    if (score > best.score) best = { index, score };
  }

  return best.score >= 2 ? best.index : -1;
}

function findColumn(headers, aliases, fuzzyText) {
  const normalizedHeaders = headers.map(normalize);

  for (const alias of aliases) {
    const index = normalizedHeaders.indexOf(alias);
    if (index !== -1) return index;
  }

  if (fuzzyText) {
    const index = normalizedHeaders.findIndex((header) => header.includes(fuzzyText));
    if (index !== -1) return index;
  }

  return -1;
}

function cell(row, index) {
  if (index === -1) return "";
  return String(row[index] || "").trim();
}

function extractDiscordId(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    const mention = text.match(/<@!?(\d{16,22})>/);
    if (mention) return mention[1];

    const plainId = text.match(/\b(\d{16,22})\b/);
    if (plainId) return plainId[1];
  }

  return "";
}

function normalizePlayerTag(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^#/, "")
    .replace(/[^A-Z0-9]/g, "");
}

function normalizePlayerName(value) {
  return normalize(value);
}

function readSheetMatrix(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false
  });
}

function parseMissingMembersWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = findMissingSheetName(workbook);

  if (!sheetName) {
    throw new Error(`Ik kan het tabblad "${SHEET_NAME}" niet vinden in dit Excel-bestand.`);
  }

  const matrix = readSheetMatrix(workbook, sheetName);

  const headerRowIndex = findHeaderRow(matrix);
  if (headerRowIndex === -1) {
    throw new Error(`Ik kan de kolomkoppen in tabblad "${sheetName}" niet herkennen.`);
  }

  const headers = matrix[headerRowIndex].map((value) => String(value || "").trim());
  const columns = {
    playerName: findColumn(headers, COLUMN_ALIASES.playerName, "name"),
    playerTag: findColumn(headers, COLUMN_ALIASES.playerTag, "tag"),
    discord: findColumn(headers, COLUMN_ALIASES.discord, "discord"),
    clan: findColumn(headers, COLUMN_ALIASES.clan, "clan"),
    clanTag: findColumn(headers, COLUMN_ALIASES.clanTag, "clantag")
  };

  const members = matrix
    .slice(headerRowIndex + 1)
    .map((row, index) => {
      const discord = cell(row, columns.discord);
      const playerName = cell(row, columns.playerName);
      const playerTag = cell(row, columns.playerTag);
      const clan = cell(row, columns.clan);
      const clanTag = cell(row, columns.clanTag);

      return {
        rowNumber: headerRowIndex + index + 2,
        discord,
        discordId: extractDiscordId(discord),
        discordSource: extractDiscordId(discord) ? "Missing members" : "",
        playerName,
        playerTag,
        normalizedPlayerTag: normalizePlayerTag(playerTag),
        normalizedPlayerName: normalizePlayerName(playerName),
        clan,
        clanTag
      };
    })
    .filter((member) => member.discord || member.playerName || member.playerTag);

  return {
    sheetName,
    headers,
    columns,
    members
  };
}

function parseMemberMappingWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const rows = [];

  for (const sheetName of workbook.SheetNames) {
    const matrix = readSheetMatrix(workbook, sheetName);
    const headerRowIndex = findHeaderRow(matrix);
    if (headerRowIndex === -1) continue;

    const headers = matrix[headerRowIndex].map((value) => String(value || "").trim());
    const columns = {
      playerName: findColumn(headers, COLUMN_ALIASES.playerName, "name"),
      playerTag: findColumn(headers, COLUMN_ALIASES.playerTag, "tag"),
      discord: findColumn(headers, COLUMN_ALIASES.discord, "discord")
    };

    if (columns.discord === -1) continue;
    if (columns.playerTag === -1 && columns.playerName === -1) continue;

    for (const [index, row] of matrix.slice(headerRowIndex + 1).entries()) {
      const discord = cell(row, columns.discord);
      const discordId = extractDiscordId(discord);
      const playerName = cell(row, columns.playerName);
      const playerTag = cell(row, columns.playerTag);

      if (!discordId || (!playerTag && !playerName)) continue;

      rows.push({
        sheetName,
        rowNumber: headerRowIndex + index + 2,
        discord,
        discordId,
        playerName,
        playerTag,
        normalizedPlayerTag: normalizePlayerTag(playerTag),
        normalizedPlayerName: normalizePlayerName(playerName)
      });
    }
  }

  const byTag = new Map();
  const byName = new Map();
  const duplicateNames = new Set();

  for (const row of rows) {
    if (row.normalizedPlayerTag && !byTag.has(row.normalizedPlayerTag)) {
      byTag.set(row.normalizedPlayerTag, row);
    }

    if (row.normalizedPlayerName) {
      if (byName.has(row.normalizedPlayerName)) duplicateNames.add(row.normalizedPlayerName);
      else byName.set(row.normalizedPlayerName, row);
    }
  }

  for (const name of duplicateNames) {
    byName.delete(name);
  }

  return {
    rows,
    byTag,
    byName,
    duplicateNames
  };
}

function applyMemberMapping(parsed, mapping) {
  if (!mapping) return parsed;

  for (const member of parsed.members) {
    if (member.discordId) continue;

    const byTag = member.normalizedPlayerTag
      ? mapping.byTag.get(member.normalizedPlayerTag)
      : null;
    const byName = member.normalizedPlayerName
      ? mapping.byName.get(member.normalizedPlayerName)
      : null;

    if (byTag) {
      member.discord = byTag.discord;
      member.discordId = byTag.discordId;
      member.discordSource = `ledenbestand: player tag, ${byTag.sheetName} rij ${byTag.rowNumber}`;
      continue;
    }

    if (byName) {
      member.discord = byName.discord;
      member.discordId = byName.discordId;
      member.discordSource = `ledenbestand: unieke spelernaam, ${byName.sheetName} rij ${byName.rowNumber}`;
      continue;
    }

    if (member.normalizedPlayerName && mapping.duplicateNames.has(member.normalizedPlayerName)) {
      member.mappingIssue = "Spelernaam komt meerdere keren voor in ledenbestand.";
    }
  }

  parsed.mapping = {
    totalRows: mapping.rows.length,
    duplicateNameCount: mapping.duplicateNames.size
  };

  return parsed;
}

module.exports = {
  applyMemberMapping,
  parseMemberMappingWorkbook,
  parseMissingMembersWorkbook
};
