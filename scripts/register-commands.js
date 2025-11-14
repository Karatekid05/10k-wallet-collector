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
	{
		name: 'stats',
		description: 'Get wallet submission statistics (admin only)',
	},
	{
		name: 'rank',
		description: 'Check your server rank and XP',
		options: [
			{
				name: 'member',
				description: 'The member to check rank for (optional)',
				type: 6, // USER type
				required: false,
			},
		],
	},
	{
		name: 'give-xp',
		description: 'Give XP to a user (admin only)',
		options: [
			{
				name: 'member',
				description: 'The member to give XP to',
				type: 6, // USER type
				required: true,
			},
			{
				name: 'amount',
				description: 'Amount of XP to give',
				type: 4, // INTEGER type
				required: true,
			},
		],
	},
	{
		name: 'remove-xp',
		description: 'Remove XP from a user (admin only)',
		options: [
			{
				name: 'member',
				description: 'The member to remove XP from',
				type: 6, // USER type
				required: true,
			},
			{
				name: 'amount',
				description: 'Amount of XP to remove',
				type: 4, // INTEGER type
				required: true,
			},
		],
	},
	{
		name: 'leaderboard',
		description: 'View the server XP leaderboard',
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


