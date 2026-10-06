'use strict';

// Release: Minecraft software/runtime catalog.
// This is deliberately backed by the same live registries the panel already
// uses instead of maintaining a stale hard-coded version list.

const generalFields = require('../config/field-catalog/general');
const mojang = require('./mojang');
const loaderVersions = require('./loaderVersions');
const { pickJavaTag } = require('./javaMatrix');
/** @type {any} */
const getBuilds = loaderVersions.getBuilds;

const TYPE_FIELD = generalFields.find((f) => f.key === 'TYPE');
const TYPES = (TYPE_FIELD?.options || []).map((o) => ({
  id: o.value,
  label: o.label,
  description: o.desc || '',
}));

const TYPE_TO_LOADER = {
  PAPER: 'paper',
  PURPUR: 'paper',
  PUFFERFISH: 'paper',
  LEAF: 'paper',
  FOLIA: 'paper',
  SPIGOT: 'paper',
  BUKKIT: 'paper',
  CANYON: 'paper',
  FABRIC: 'fabric',
  QUILT: 'quilt',
  FORGE: 'forge',
  NEOFORGE: 'neoforge',
};

const JAVA_OPTIONS = [
  { tag: '', label: 'Auto', description: 'Select Java from the Minecraft/server-type compatibility matrix.' },
  { tag: 'java8', label: 'Java 8', description: 'Legacy Minecraft/Forge runtime.' },
  { tag: 'java16', label: 'Java 16', description: 'Minecraft 1.17 and Paper 1.16.5.' },
  { tag: 'java17', label: 'Java 17', description: 'Minecraft 1.18 through 1.20.4.' },
  { tag: 'java21', label: 'Java 21', description: 'Minecraft 1.20.5 and newer 1.21-era releases.' },
  { tag: 'java25', label: 'Java 25', description: 'Newest runtime for current Minecraft releases.' },
];

function types() {
  return TYPES.map((t) => ({ ...t, loader: TYPE_TO_LOADER[t.id] || null }));
}

async function versions({ includeSnapshots = false, limit = 200 } = {}) {
  const list = await mojang.listVersions({ includeSnapshots, limit });
  return list;
}

async function builds({ type, mcVersion, channel } = {}) {
  const loader = TYPE_TO_LOADER[String(type || '').toUpperCase()];
  if (!loader) return { loader: null, envKey: null, builds: [], default: '' };
  return getBuilds(loader, mcVersion, { channel });
}

function java({ type, mcVersion, maxJavaVersion = null } = {}) {
  const selectedType = String(type || 'VANILLA').toUpperCase();
  const selectedVersion = String(mcVersion || 'LATEST');
  const auto = pickJavaTag(selectedVersion, selectedType, { maxJavaVersion });
  return {
    auto,
    options: JAVA_OPTIONS,
    reason: `Auto selected ${auto} for ${selectedType} ${selectedVersion}.`,
  };
}

function contentSources({ kind = 'mod' } = {}) {
  const k = String(kind).toLowerCase();
  if (k === 'plugin') {
    return [
      { id: 'modrinth', label: 'Modrinth', requiresKey: false },
      { id: 'hangar', label: 'Hangar', requiresKey: false },
      { id: 'spiget', label: 'SpigotMC / Spiget', requiresKey: false },
      { id: 'curseforge', label: 'CurseForge', requiresKey: true },
    ];
  }
  if (['mod', 'datapack', 'resourcepack'].includes(k)) {
    return [
      { id: 'modrinth', label: 'Modrinth', requiresKey: false },
      { id: 'curseforge', label: 'CurseForge', requiresKey: true },
    ];
  }
  if (k === 'modpack') {
    return [
      { id: 'modrinth', label: 'Modrinth', requiresKey: false },
      { id: 'curseforge', label: 'CurseForge', requiresKey: true },
      { id: 'ftb', label: 'Feed The Beast', requiresKey: false },
      { id: 'gtnh', label: 'GT New Horizons', requiresKey: false },
    ];
  }
  return [];
}

function compatibility({ type, mcVersion, loaderVersion } = {}) {
  const t = String(type || '').toUpperCase();
  const mc = String(mcVersion || 'LATEST');
  const loader = TYPE_TO_LOADER[t] || null;
  const warnings = [];
  if (!loader && ['AUTO_CURSEFORGE', 'MODRINTH', 'FTBA', 'GTNH'].includes(t)) {
    warnings.push('This server type obtains its loader/software from its managed pack. Do not force a loader build unless the pack documentation requires it.');
  }
  if (loader && !loaderVersion) warnings.push(`No ${loader} build is pinned; the container will resolve the current compatible build.`);
  if (t === 'FORGE' && /^1\.(?:16|15|14|13|12|11|10|9|8|7|6|5|4|3|2|1)\./.test(mc)) {
    warnings.push('Older Forge releases generally require Java 8. The automatic Java matrix will select it.');
  }
  return { ok: warnings.length === 0, loader, minecraftVersion: mc, warnings };
}

async function catalog({ includeSnapshots = false, versionLimit = 200 } = {}) {
  const result = { types: types(), java: JAVA_OPTIONS, sources: {} };
  result.versions = await versions({ includeSnapshots, limit: versionLimit });
  for (const kind of ['mod', 'plugin', 'datapack', 'resourcepack', 'modpack']) {
    result.sources[kind] = contentSources({ kind });
  }
  return result;
}

module.exports = {
  types,
  versions,
  builds,
  java,
  contentSources,
  compatibility,
  catalog,
  TYPE_TO_LOADER,
};
