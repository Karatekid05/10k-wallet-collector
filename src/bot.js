import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, EmbedBuilder } from 'discord.js';
import { upsertWallet, getWallet, getAllWallets, ensureSheetSetup, getStatistics } from './sheets.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
	console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment');
	process.exit(1);
}

// Special role that allows stacking (can submit in FCFS even with higher tier)
const FIRE_ROLE_ID = '1411717220605886616';

// Define role configurations for each tier
const TIER_CONFIGS = {
	'2GTD': {
		tier: '2GTD',
		roleIds: ['1334873841780002937'],
		commandName: 'setup-2gtd',
		channelLink: 'https://discord.com/channels/1282268775709802568/1437876379982237766',
	},
	'GTD': {
		tier: 'GTD',
		roleIds: [
			'1334873106854187008',
			'1360990505021870144',
			'1405560532223922287',
			'1362770935886774284',
			'1407649035657019463',
			'1284341434564083763',
			'1411997961399046154',
			'1438971031070179539',
			'1438971832869847170',
			'1438971608340627549',
		],
		commandName: 'setup-gtd',
		channelLink: 'https://discord.com/channels/1282268775709802568/1437876707502592143',
	},
	'FCFS': {
		tier: 'FCFS',
		roleIds: [
			'1334873797085626398',
			'1408402916452208702',
			'1351262150617726976',
			'1351262256696004648',
			'1351262382332055643',
			'1356486622161404026',
			'1351760706613018635',
			FIRE_ROLE_ID, // Fire role - allows stacking
		],
		commandName: 'setup-fcfs',
		channelLink: 'https://discord.com/channels/1282268775709802568/1437876834476884100',
	},
};

// Helper function to get member's role IDs
async function getMemberRoleIds(interaction) {
	if (!interaction.guild) return new Set();
	const member = interaction.member;

	// Try to read roles from the interaction payload
	if (member && member.roles) {
		// Cached GuildMember
		if ('cache' in member.roles) {
			try {
				return new Set(member.roles.cache.map((r) => r.id));
			} catch { }
		}
		// Raw roles array from API payload
		if (Array.isArray(member.roles)) {
			return new Set(member.roles);
		}
	}

	// Fallback: fetch full member
	try {
		const fullMember = await interaction.guild.members.fetch(interaction.user.id);
		return new Set(fullMember.roles.cache.map((r) => r.id));
	} catch {
		return new Set();
	}
}

// Helper function to get role name by ID
async function getRoleName(interaction, roleId) {
	try {
		if (!interaction.guild) return null;
		const role = await interaction.guild.roles.fetch(roleId);
		return role ? role.name : null;
	} catch {
		return null;
	}
}

// Check if user has any of the specified role IDs for a tier
async function getUserTierRole(interaction, tierConfig) {
	try {
		const userRoleIds = await getMemberRoleIds(interaction);

		// Find first matching role
		for (const roleId of tierConfig.roleIds) {
			if (userRoleIds.has(roleId)) {
				const roleName = await getRoleName(interaction, roleId);
				return roleName;
			}
		}
		return null;
	} catch {
		return null;
	}
}

// Get the highest tier the user has access to (based on priority)
async function getUserHighestTier(interaction) {
	const userRoleIds = await getMemberRoleIds(interaction);

	// Check tiers in priority order (highest to lowest)
	// Priority: 2GTD > GTD > FCFS

	// Check 2GTD (highest priority)
	for (const roleId of TIER_CONFIGS['2GTD'].roleIds) {
		if (userRoleIds.has(roleId)) {
			return '2GTD';
		}
	}

	// Check GTD (medium priority)
	for (const roleId of TIER_CONFIGS['GTD'].roleIds) {
		if (userRoleIds.has(roleId)) {
			return 'GTD';
		}
	}

	// Check FCFS (lowest priority)
	for (const roleId of TIER_CONFIGS['FCFS'].roleIds) {
		if (userRoleIds.has(roleId)) {
			return 'FCFS';
		}
	}

	return null; // User has no qualifying roles
}

// Check if user can submit to a specific tier (considering hierarchy)
async function canUserSubmitToTier(interaction, targetTier) {
	const userRoleIds = await getMemberRoleIds(interaction);
	const hasFire = userRoleIds.has(FIRE_ROLE_ID);
	const highestTier = await getUserHighestTier(interaction);

	if (!highestTier) {
		return { allowed: false, reason: 'no_role' };
	}

	// Define tier priority (lower number = higher priority)
	const tierPriority = {
		'2GTD': 1,
		'GTD': 2,
		'FCFS': 3,
	};

	const userPriority = tierPriority[highestTier];
	const targetPriority = tierPriority[targetTier];

	// SPECIAL CASE: Fire role allows stacking
	// Users with 2GTD/GTD + Fire can ALSO submit to FCFS
	if (targetTier === 'FCFS' && hasFire && userPriority < targetPriority) {
		// User has higher tier (2GTD or GTD) + Fire role
		// Allow them to submit to FCFS as well (stacking)
		return {
			allowed: true,
			tier: 'FCFS',
			isStacking: true,
			primaryTier: highestTier
		};
	}

	if (userPriority < targetPriority) {
		// User has a higher tier, cannot submit to lower tier (unless Fire exception above)
		return {
			allowed: false,
			reason: 'higher_tier_available',
			highestTier: highestTier
		};
	}

	if (userPriority === targetPriority) {
		// User can submit to their own tier
		return { allowed: true, tier: highestTier };
	}

	// User priority is higher than target (shouldn't happen in normal flow)
	return { allowed: false, reason: 'invalid_tier' };
}

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
	],
	partials: [Partials.Channel],
});

client.once('ready', () => {
	console.log(`Logged in as ${client.user.tag}`);
});

// Register commands on startup (guild-scoped if GUILD_ID provided, otherwise global)
async function registerCommands() {
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
	try {
		if (guildId) {
			await rest.put(
				Routes.applicationGuildCommands(clientId, guildId),
				{ body: commands },
			);
			console.log('Guild commands registered.');
		} else {
			await rest.put(Routes.applicationCommands(clientId), { body: commands });
			console.log('Global commands registered (may take up to 1 hour to appear).');
		}
	} catch (err) {
		console.error('Failed to register commands:', err);
	}
}

client.on('interactionCreate', async (interaction) => {
	try {
		if (interaction.isChatInputCommand()) {
			console.log(`[COMMAND] ${interaction.user.username} used /${interaction.commandName}`);

			// Handle setup commands for each tier
			const tierConfig = Object.values(TIER_CONFIGS).find(
				(config) => config.commandName === interaction.commandName
			);

			if (tierConfig) {
				try {
					// Respond immediately - we don't need to wait for anything
					const submitButton = new ButtonBuilder()
						.setCustomId(`submit_wallet_${tierConfig.tier}`)
						.setLabel('Submit Wallet')
						.setStyle(ButtonStyle.Success);

					const statusButton = new ButtonBuilder()
						.setCustomId(`check_status_${tierConfig.tier}`)
						.setLabel('Check Status')
						.setStyle(ButtonStyle.Primary);

					const row = new ActionRowBuilder().addComponents(submitButton, statusButton);

					const embed = new EmbedBuilder()
						.setTitle(`${tierConfig.tier} Tier - Submit your EVM Wallet`)
						.setDescription('Click the button below to submit your wallet address.')
						.setColor(0x2b2d31);

					// Reply immediately
					await interaction.reply({
						embeds: [embed],
						components: [row],
						allowedMentions: { parse: [] },
					});

					console.log(`[SUCCESS] Setup message sent for ${tierConfig.tier}`);

				} catch (err) {
					console.error(`[ERROR] Exception in setup command:`, err);
					try {
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({
								content: '❌ An error occurred. Please try again.',
								ephemeral: true
							});
						}
					} catch { }
				}
			}

			// Handle /stats command
			if (interaction.commandName === 'stats') {
				const ADMIN_USER_IDS = [
					'1189888338879074415', // puresoul0109
					'412710839070752778',  // karatekid05
				];

				// Only allow specific users to use this command
				if (!ADMIN_USER_IDS.includes(interaction.user.id)) {
					await interaction.reply({
						content: '❌ You do not have permission to use this command.',
						ephemeral: true,
					});
					return;
				}

				await interaction.deferReply({ ephemeral: true });

				try {
					const stats = await getStatistics();

					// Format the statistics message
					let message = '📊 **Wallet Submission Statistics**\n\n';

					// 2GTD Stats
					message += `**🏆 2GTD Tier**\n`;
					message += `├─ Total: **${stats['2GTD'].total}** wallets\n`;
					const roles2GTD = Object.entries(stats['2GTD'].byRole);
					if (roles2GTD.length > 0) {
						roles2GTD.forEach(([role, count], idx) => {
							const prefix = idx === roles2GTD.length - 1 ? '└─' : '├─';
							message += `${prefix} ${role}: **${count}**\n`;
						});
					} else {
						message += '└─ No submissions yet\n';
					}
					message += '\n';

					// 1GTD Stats
					message += `**⭐ 1GTD (GTD) Tier**\n`;
					message += `├─ Total: **${stats['1GTD'].total}** wallets\n`;
					const roles1GTD = Object.entries(stats['1GTD'].byRole);
					if (roles1GTD.length > 0) {
						roles1GTD.forEach(([role, count], idx) => {
							const prefix = idx === roles1GTD.length - 1 ? '└─' : '├─';
							message += `${prefix} ${role}: **${count}**\n`;
						});
					} else {
						message += '└─ No submissions yet\n';
					}
					message += '\n';

					// FCFS Stats
					message += `**🔥 FCFS Tier**\n`;
					message += `├─ Total: **${stats['FCFS'].total}** wallets\n`;
					const rolesFCFS = Object.entries(stats['FCFS'].byRole);
					if (rolesFCFS.length > 0) {
						rolesFCFS.forEach(([role, count], idx) => {
							const prefix = idx === rolesFCFS.length - 1 ? '└─' : '├─';
							message += `${prefix} ${role}: **${count}**\n`;
						});
					} else {
						message += '└─ No submissions yet\n';
					}
					message += '\n';

					// Grand total
					const grandTotal = stats['2GTD'].total + stats['1GTD'].total + stats['FCFS'].total;
					message += `**📈 Total Submissions: ${grandTotal}**`;

					// Send DM to BOTH admins
					let successCount = 0;
					let failedUsers = [];

					for (const adminId of ADMIN_USER_IDS) {
						try {
							const adminUser = await client.users.fetch(adminId);
							await adminUser.send(message);
							successCount++;
						} catch (dmError) {
							console.error(`Failed to send DM to ${adminId}:`, dmError);
							failedUsers.push(adminId);
						}
					}

					// Send confirmation
					if (successCount === ADMIN_USER_IDS.length) {
						await interaction.editReply({
							content: '✅ Statistics sent via DM to all admins!',
						});
					} else if (successCount > 0) {
						await interaction.editReply({
							content: `⚠️ Statistics sent to ${successCount}/${ADMIN_USER_IDS.length} admins. Some DMs failed.`,
						});
					} else {
						// If all DMs failed, send as ephemeral reply
						await interaction.editReply({
							content: `❌ Failed to send DMs. Here are the stats:\n\n${message}`,
						});
					}
				} catch (error) {
					console.error('[ERROR] Failed to get statistics:', error);
					await interaction.editReply({
						content: '❌ Failed to retrieve statistics. Please try again.',
					});
				}
			}
		}

		if (interaction.isButton()) {
			console.log(`[BUTTON] ${interaction.user.username} clicked: ${interaction.customId}`);

			// Handle submit wallet button
			if (interaction.customId.startsWith('submit_wallet_')) {
				const tier = interaction.customId.replace('submit_wallet_', '');
				const tierConfig = TIER_CONFIGS[tier];

				if (!tierConfig) {
					await interaction.reply({
						content: 'Invalid tier configuration.',
						ephemeral: true
					});
					return;
				}

				// Check if user can submit to this tier (with hierarchy check)
				const canSubmit = await canUserSubmitToTier(interaction, tier);

				if (!canSubmit.allowed) {
					if (canSubmit.reason === 'no_role') {
						await interaction.reply({
							content: `❌ You don't have any of the required roles to submit a wallet.`,
							ephemeral: true,
						});
					} else if (canSubmit.reason === 'higher_tier_available') {
						const correctTierConfig = TIER_CONFIGS[canSubmit.highestTier];
						await interaction.reply({
							content: `❌ You have a **${canSubmit.highestTier}** tier role, so you cannot submit to the **${tier}** tier.\n\n➡️ **Please go to the correct channel:**\n${correctTierConfig.channelLink}`,
							ephemeral: true,
						});
					} else {
						await interaction.reply({
							content: `❌ You cannot submit to the ${tier} tier.`,
							ephemeral: true,
						});
					}
					return;
				}

				// Get user's role name for this tier
				const userRole = await getUserTierRole(interaction, tierConfig);
				if (!userRole) {
					await interaction.reply({
						content: `❌ Could not fetch your role information. Please try again.`,
						ephemeral: true,
					});
					return;
				}

				// Show modal for wallet submission
				const modal = new ModalBuilder()
					.setCustomId(`wallet_modal_${tier}`)
					.setTitle(`Submit your ${tier} EVM Wallet`);

				const walletInput = new TextInputBuilder()
					.setCustomId('wallet_address')
					.setLabel('EVM wallet address (0x...)')
					.setStyle(TextInputStyle.Short)
					.setPlaceholder('0x...')
					.setRequired(true)
					.setMaxLength(100);

				const row = new ActionRowBuilder().addComponents(walletInput);
				modal.addComponents(row);
				await interaction.showModal(modal);
			}

			// Handle check status button
			if (interaction.customId.startsWith('check_status_')) {
				await interaction.deferReply({ ephemeral: true });
				const wallets = await getAllWallets(interaction.user.id);

				if (!wallets) {
					await interaction.editReply('You have not submitted any wallets yet.');
					return;
				}

				const embed = new EmbedBuilder()
					.setTitle('Your Wallet Submissions')
					.setDescription(`You have **${wallets.length}** wallet submission${wallets.length > 1 ? 's' : ''}`)
					.setColor(0x2ecc71)
					.addFields(
						{ name: 'Discord Username', value: wallets[0].discordUsername || 'Unknown', inline: true },
						{ name: 'Discord ID', value: wallets[0].discordId, inline: true },
					);

				// Add each wallet submission as a separate field
				wallets.forEach((wallet, index) => {
					const tierEmoji = wallet.tier === '2GTD' ? '💎' : wallet.tier === '1GTD' ? '⭐' : '🔥';
					embed.addFields({
						name: `${tierEmoji} ${wallet.tier} Tier`,
						value: `**Role:** ${wallet.role || 'N/A'}\n**Wallet:** \`${wallet.wallet || 'N/A'}\``,
						inline: false
					});
				});

				// Add stacking indicator if user has multiple submissions
				if (wallets.length > 1) {
					embed.setFooter({ text: '🔥 Fire Role Stacking Active - You have multiple tier submissions' });
				}

				await interaction.editReply({ embeds: [embed] });
			}
		}

		if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('wallet_modal_')) {
			console.log(`[MODAL] ${interaction.user.username} submitted wallet for ${interaction.customId}`);
			await interaction.deferReply({ ephemeral: true });

			const tier = interaction.customId.replace('wallet_modal_', '');
			const tierConfig = TIER_CONFIGS[tier];

			if (!tierConfig) {
				await interaction.editReply('❌ Invalid tier configuration.');
				return;
			}

			// Re-verify user can submit to this tier (double-check in case roles changed)
			const canSubmit = await canUserSubmitToTier(interaction, tier);

			if (!canSubmit.allowed) {
				if (canSubmit.reason === 'no_role') {
					await interaction.editReply(`❌ You don't have any of the required roles to submit a wallet.`);
				} else if (canSubmit.reason === 'higher_tier_available') {
					const correctTierConfig = TIER_CONFIGS[canSubmit.highestTier];
					await interaction.editReply(
						`❌ You have a **${canSubmit.highestTier}** tier role, so you cannot submit to the **${tier}** tier.\n\n➡️ **Please go to the correct channel:**\n${correctTierConfig.channelLink}`
					);
				} else {
					await interaction.editReply(`❌ You cannot submit to the ${tier} tier.`);
				}
				return;
			}

			// Get user's role name
			const userRoleName = await getUserTierRole(interaction, tierConfig);
			if (!userRoleName) {
				await interaction.editReply(`❌ Could not fetch your role information. Please try again.`);
				return;
			}

			const wallet = interaction.fields.getTextInputValue('wallet_address').trim();

			// Basic EVM address validation
			const isLikelyEvm = /^0x[a-fA-F0-9]{40}$/i.test(wallet);
			if (!isLikelyEvm) {
				await interaction.editReply('❌ Invalid EVM address. Please submit a valid 0x... address (42 characters).');
				return;
			}

			const discordId = interaction.user.id;
			const discordUsername = interaction.user.username;

			const result = await upsertWallet({
				discordId,
				discordUsername,
				wallet,
				tier: tierConfig.tier,
				roleName: userRoleName,
			});

			if (result.action === 'skipped') {
				await interaction.editReply('❌ Failed to save wallet. Please try again.');
			} else {
				// Check if user is stacking (has Fire + higher tier)
				const userRoleIds = await getMemberRoleIds(interaction);
				const hasFire = userRoleIds.has(FIRE_ROLE_ID);
				const highestTier = await getUserHighestTier(interaction);

				let message = `✅ Wallet ${result.action === 'updated' ? 'updated' : 'saved'} successfully in **${tier}** tier!`;

				// Add stacking info if applicable
				if (tier === 'FCFS' && hasFire && highestTier !== 'FCFS') {
					message += `\n\n🔥 **Fire Role Stacking Active!** You can have a different wallet in **${highestTier}** tier and another in **FCFS** tier.`;
				}

				await interaction.editReply(message);
			}
		}
	} catch (err) {
		console.error('Interaction error:', err);
		try {
			if ('deferred' in interaction && interaction.deferred) {
				await interaction.editReply('There was an error. Please try again.');
			} else if ('replied' in interaction && interaction.replied) {
				await interaction.followUp({ content: 'There was an error. Please try again.', ephemeral: true });
			} else if (interaction.isRepliable()) {
				await interaction.reply({ content: 'There was an error. Please try again.', ephemeral: true });
			}
		} catch { }
	}
});

// Warm up Sheets (creates sheet and headers if needed) and register commands
console.log('Setting up Google Sheets...');
ensureSheetSetup()
	.then(() => console.log('✅ Google Sheets ready'))
	.catch((err) => console.error('⚠️  Sheets warm-up failed (will retry on first use):', err.message));

await registerCommands();
client.login(token);


