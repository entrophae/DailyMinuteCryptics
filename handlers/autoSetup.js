import { ChannelType, ChannelSelectMenuBuilder, MessageFlags, PermissionsBitField, ActionRowBuilder } from 'discord.js';
import { updateServerChannel } from '../database.js';
import { COLOURS } from '../constants.js';

export async function autoSetup(guild) {
    try {
        const setupChannel = guild.systemChannel || guild.channels.cache.find(c => 
            c.type === 0 && c.permissionsFor(guild.members.me).has('SendMessages')
        );

        if (setupChannel.permissionsFor(guild.members.me).has('SendMessages')) {
            const setupEmbed = {
                title: '👋 Thanks for adding Daily Minute Cryptics!',
                color: COLOURS.indicators.hex,
                description: 'To get started, please select the channel below where you want the daily clues to be posted:'
            };

            const row = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('setup_active_channel')
                    .setPlaceholder('Select the daily clue channel...')
                    .addChannelTypes(ChannelType.GuildText)
            );

            await setupChannel.send({ embeds: [setupEmbed], components: [row] });
        } else {
            setTimeout(() => autoSetup(guild), 5 * 60 * 1000);
        }
    } catch (err) {
        console.error(`Could not send setup message in ${guild.name}:`, err);
    }
}

export async function handleAutoSetup(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.reply({ 
            content: '❌ Only server admins or managers can configure the bot.', 
            flags: MessageFlags.Ephemeral 
        });
    }

    try {
        const selectedChannelId = interaction.values[0]; 
        
        await updateServerChannel(interaction.guild.id, selectedChannelId);
        
        await interaction.reply({ 
            content: `✅ Server active channel has been successfully set to <#${selectedChannelId}>!`, 
            flags: MessageFlags.Ephemeral 
        });

        await interaction.message.edit({ components: [] }).catch(() => {});
    } catch (error) {
        console.error("Error setting channel from dropdown:", error);
        await interaction.reply({ content: 'There was an error saving the channel!', flags: MessageFlags.Ephemeral });
    }
}