module.exports = {
	apps: [
		{
			name: 'discord-wallet-collector',
			script: 'src/bot.js',
			interpreter: 'node',
			env: {
				NODE_ENV: 'production',
			},
			autorestart: true,
			restart_delay: 5000,
			watch: false,
		},
	],
};


