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

async function main() {
	try {
		if (guildId) {
			await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
			console.log('Registered guild commands.');
		} else {
			await rest.put(Routes.applicationCommands(clientId), { body: commands });
			console.log('Registered global commands.');
		}
	} catch (err) {
		console.error(err);
		process.exit(1);
	}
}

main();


