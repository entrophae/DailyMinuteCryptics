import { SlashCommandBuilder, ChannelType} from 'discord.js';
import { updateServerChannel } from '../../database.js';

export default {
	data: new SlashCommandBuilder()
        .setName('active-channel')
        .setDescription('Set the channel to send the daily clue reminders')
        .addChannelOption(option => 
            option.setName('channel')
            .setDescription('text channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        ),
    
	async execute(interaction) {
        const selectedChannel = interaction.options.getChannel('channel');

        await interaction.deferReply();

        await updateServerChannel(interaction.guild.id, selectedChannel.id);

        return interaction.editReply(`✅ Server active channel has been successfully updated to **${selectedChannel}**.`);
    },
};
