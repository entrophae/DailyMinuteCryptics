import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getServerChannel } from '../../database.js';
import { sendClueEmbed } from '../../handlers/solver.js';

export default {
    
    data: new SlashCommandBuilder()
        .setName('current-clue')
        .setDescription('Posts the current daily clue to the active channel'),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const serverId = interaction.guild.id;
        
        const activeChannelId = await getServerChannel(serverId);
        if (!activeChannelId) {
            return interaction.editReply("An active channel hasn't been set for this server yet. An admin needs to use the `/active-channel` command first!");
        }

        await sendClueEmbed(interaction.client, serverId);

        return interaction.editReply(`The current clue has been posted in <#${activeChannelId}>!`);
    },
};