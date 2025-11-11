import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
	console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID');
	process.exit(1);
}

const commands = [
	{
		name: 'setup-2gtd',
		description: 'Post 2GTD tier wallet submission message (2 GTD allocation)',
	},
	{
		name: 'setup-gtd',
		description: 'Post GTD tier wallet submission message (1 GTD allocation)',
	},
	{
		name: 'setup-fcfs',
		description: 'Post FCFS tier wallet submission message',
	},
];

const rest = new REST({ version: '10' }).setToken(token);

async function resetCommands() {
	try {
		console.log('🗑️  Deleting all existing commands...\n');
		
		// Delete guild commands
		if (guildId) {
			await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
			console.log('✅ Guild commands deleted');
		}
		
		// Delete global commands
		await rest.put(Routes.applicationCommands(clientId), { body: [] });
		console.log('✅ Global commands deleted');
		
		console.log('\n⏳ Waiting 2 seconds...\n');
		await new Promise(resolve => setTimeout(resolve, 2000));
		
		console.log('📝 Re-registering commands...\n');
		
		if (guildId) {
			await rest.put(
				Routes.applicationGuildCommands(clientId, guildId),
				{ body: commands }
			);
			console.log('✅ Guild commands registered:');
			commands.forEach(cmd => console.log(`   - /${cmd.name}`));
		} else {
			await rest.put(
				Routes.applicationCommands(clientId),
				{ body: commands }
			);
			console.log('✅ Global commands registered (may take up to 1 hour):');
			commands.forEach(cmd => console.log(`   - /${cmd.name}`));
		}
		
		console.log('\n🎉 Commands reset complete!');
		console.log('\n💡 Tip: Try restarting your Discord client (Ctrl+R or completely close/reopen)');
		
	} catch (err) {
		console.error('❌ Error resetting commands:', err);
		process.exit(1);
	}
}

resetCommands();

