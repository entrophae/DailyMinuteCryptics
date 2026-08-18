import { SlashCommandBuilder} from 'discord.js';
import { updateServerTimezone} from '../../database';

const timezones = Intl.supportedValuesOf('timeZone');

export default {
	data: new SlashCommandBuilder()
        .setName('timezone')
        .setDescription('Set the timezone to rely on when checking for the daily clue')
        .addStringOption((option) =>
            option.setName('location')
                .setDescription('Type a city or country (e.g., Berlin, Tokyo, America)')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    
    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused(); 

        const filtered = timezones.filter(zone => zone.toLowerCase().includes(focusedValue.toLowerCase()));
        const limitedFiltered = filtered.slice(0,25);
        await interaction.respond(
            limitedFiltered.map((choice) => ({ name: choice, value: choice }))
        );
    },

	async execute(interaction) {
        const selectedTimezone = interaction.options.getString('location');

        // Extra safety check in case they submitted something random instead of clicking a choice
        if (!timezones.includes(selectedTimezone)) {
            return interaction.reply({ 
                content: `❌ \`${selectedTimezone}\` is not a valid timezone. Please select one from the autocomplete list.`, 
                ephemeral: true 
            });
        }

        await interaction.deferReply();

        // Save to your database
        await updateServerTimezone(interaction.guild.id, selectedTimezone);

        return interaction.editReply(`✅ Server timezone has been successfully updated to **${selectedTimezone}**.`);
    },
};
