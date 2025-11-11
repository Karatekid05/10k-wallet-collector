import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
	console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID');
	process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function checkCommands() {
	try {
		console.log('🔍 Checking registered commands...\n');
		
		if (guildId) {
			// Check guild commands
			const guildCommands = await rest.get(
				Routes.applicationGuildCommands(clientId, guildId)
			);
			console.log(`📍 Guild Commands (${guildCommands.length}):`);
			guildCommands.forEach(cmd => {
				console.log(`  - /${cmd.name} (ID: ${cmd.id})`);
			});
		}
		
		// Check global commands
		const globalCommands = await rest.get(
			Routes.applicationCommands(clientId)
		);
		console.log(`\n🌍 Global Commands (${globalCommands.length}):`);
		globalCommands.forEach(cmd => {
			console.log(`  - /${cmd.name} (ID: ${cmd.id})`);
		});
		
		console.log('\n✅ Command check complete!');
		
	} catch (err) {
		console.error('❌ Error checking commands:', err);
		process.exit(1);
	}
}

checkCommands();

