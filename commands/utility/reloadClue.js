import { SlashCommandBuilder, MessageFlags, PermissionsBitField } from 'discord.js';
import { savePuzzle, updateServerPuzzle } from '../../database.js';
import { reloadLiveMessage } from '../../handlers/clue/clueRenderer.js';
import { getPuzzleRequestData } from '../../handlers/clue/puzzleSync.js';

export default {
    data: new SlashCommandBuilder()
        .setName('reload-clue')
        .setDescription('Force reload the current daily clue from the API and update the live message')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const serverId = interaction.guild.id;
            
            const puzzleData = await getPuzzleRequestData(serverId);
            
            if (puzzleData.ok === false) {
                return interaction.editReply(`Failed to fetch puzzle: API returned ${puzzleData.status}`);
            }

            await savePuzzle(puzzleData);
            await updateServerPuzzle(serverId, puzzleData.puzzleId, puzzleData.date);

            const success = await reloadLiveMessage(interaction.client, serverId);

            if (success) {
                return interaction.editReply(`✅ Successfully reloaded the clue for **${puzzleData.date}** and updated the live message!`);
            } else {
                return interaction.editReply(`⚠️ Successfully reloaded the database, but couldn't find the live channel message to edit.`);
            }
        } catch (err) {
            console.error("Error reloading clue:", err);
            return interaction.editReply("An error occurred while trying to reload the clue.");
        }
    },
};