import { EmbedBuilder } from 'discord.js';
import { outdent } from 'outdent';
import { command } from '#bot/commands.ts';
import { version as botVersion } from '#const/config.ts';
import { getTexts } from '#models/managerDb/textModel.ts';
import type { PatchnotesEntry, TextsPatchnotes } from '#models/types/external.d.ts';

export default command({
  name: 'patchnote',
  async execute({ interaction, options }) {
    const version = options.version;
    const { patchnotes } = await getTexts();

    const applicableVersions = patchnotes.map((note) => note.version);
    applicableVersions.push('latest');

    let embed: EmbedBuilder;

    if (!version || !applicableVersions.includes(version)) {
      embed = patchnotesMainEmbed(patchnotes);
    } else if (version === 'latest') {
      embed = patchnotesVersionEmbed(patchnotes[0]);
    } else {
      const matchPatchnote = (note: PatchnotesEntry): boolean =>
        note.version === version.toLowerCase();
      // applicableVersions.includes(version) has already been checked above; this `find()` cannot fail
      embed = patchnotesVersionEmbed(patchnotes.find(matchPatchnote) as PatchnotesEntry);
    }

    await interaction.reply({ embeds: [embed] });
  },
  autocompletes: {
    async version({ interaction }) {
      const { patchnotes } = await getTexts();

      const focused = interaction.options.getFocused().replace('v', '').replace('.', '');
      const versions = [
        'latest',
        ...patchnotes
          .map((note) => note.version)
          .filter((version) => version.replace('.', '').includes(focused)),
      ].slice(0, 25);

      await interaction.respond(versions.map((o) => ({ name: o, value: o })));
    },
  },
});

function patchnotesMainEmbed(patchnotes: TextsPatchnotes) {
  const embed = new EmbedBuilder()
    .setTitle('**Husky Patchnotes**')
    .setColor(0x36608e)
    .setDescription(outdent`
      *v${botVersion}*
      Check what's going on with Husky.`);

  for (const patchnote of patchnotes)
    embed.addFields({
      name: `Patch ${patchnote.version} - ${patchnote.title} (${patchnote.date})`,
      value: patchnote.desc,
    });

  return embed;
}

function patchnotesVersionEmbed(patchnote: PatchnotesEntry) {
  const embed = new EmbedBuilder()
    .setColor(0x36608e)
    .setTitle(`**Patch ${patchnote.version} - ${patchnote.title} (${patchnote.date})**`);

  if (patchnote.desc) {
    embed.setDescription(patchnote.desc);
  }

  for (const feature of patchnote.features) {
    const val = feature.desc || feature.description;
    if (val) embed.addFields({ name: feature.title, value: val });
  }

  for (const fix of patchnote.fixes) {
    const val = fix.desc || fix.description;
    if (val) embed.addFields({ name: fix.title, value: val });
  }

  return embed;
}
