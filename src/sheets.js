import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const {
	GOOGLE_SHEETS_SPREADSHEET_ID,
	GOOGLE_SERVICE_ACCOUNT_EMAIL,
	GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
} = process.env;

if (!GOOGLE_SHEETS_SPREADSHEET_ID) {
	throw new Error('Missing GOOGLE_SHEETS_SPREADSHEET_ID in environment.');
}
if (!GOOGLE_SERVICE_ACCOUNT_EMAIL) {
	throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL in environment.');
}
if (!GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
	throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in environment.');
}

// Support both raw and \n-escaped private keys
const privateKey = GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n');

const auth = new google.auth.JWT({
	email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
	key: privateKey,
	scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheetsApi = google.sheets({ version: 'v4', auth });

// Three separate sheets for different allocation tiers
const SHEET_NAMES = {
	TWO_GTD: '2GTD',
	ONE_GTD: '1GTD',
	FCFS: 'FCFS',
};
const HEADER_ROW = ['Discord Username', 'Discord ID', 'Role', 'EVM Wallet'];

// Map tier to sheet name
function getSheetNameForTier(tier) {
	if (tier === '2GTD') return SHEET_NAMES.TWO_GTD;
	if (tier === 'GTD') return SHEET_NAMES.ONE_GTD;
	if (tier === 'FCFS') return SHEET_NAMES.FCFS;
	return null;
}

async function callWithRetry(requestFn, description = 'Sheets API call') {
	const maxAttempts = 5;
	let attempt = 0;
	let delayMs = 1000;
	while (true) {
		try {
			return await requestFn();
		} catch (err) {
			attempt++;
			const status = err?.code || err?.status || err?.response?.status || err?.cause?.code;
			const isRateLimited = status === 429 || err?.cause?.status === 'RESOURCE_EXHAUSTED';
			if (!isRateLimited || attempt >= maxAttempts) {
				throw err;
			}
			await new Promise((r) => setTimeout(r, delayMs + Math.floor(Math.random() * 250)));
			delayMs = Math.min(delayMs * 2, 15000);
		}
	}
}

export async function ensureSheetSetup() {
	// Ensure all three sheets exist with headers
	const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID;
	const spreadsheet = await callWithRetry(() => sheetsApi.spreadsheets.get({ spreadsheetId }), 'spreadsheets.get');
	
	const existingSheets = new Set(
		spreadsheet.data.sheets?.map((s) => s.properties?.title) || []
	);
	
	// Create any missing sheets
	const sheetsToCreate = [];
	for (const sheetName of Object.values(SHEET_NAMES)) {
		if (!existingSheets.has(sheetName)) {
			sheetsToCreate.push({ addSheet: { properties: { title: sheetName } } });
		}
	}
	
	if (sheetsToCreate.length > 0) {
		await callWithRetry(() => sheetsApi.spreadsheets.batchUpdate({
			spreadsheetId,
			requestBody: { requests: sheetsToCreate },
		}), 'spreadsheets.batchUpdate create sheets');
	}
	
	// Write header row for each sheet if needed
	for (const sheetName of Object.values(SHEET_NAMES)) {
		const range = `${sheetName}!A1:D1`;
		const current = await callWithRetry(() => sheetsApi.spreadsheets.values.get({ spreadsheetId, range }), 'values.get header');
		const firstRow = current.data.values?.[0] ?? [];
		if (firstRow.length === 0 || HEADER_ROW.some((h, i) => firstRow[i] !== h)) {
			await callWithRetry(() => sheetsApi.spreadsheets.values.update({
				spreadsheetId,
				range,
				valueInputOption: 'RAW',
				requestBody: { values: [HEADER_ROW] },
			}), 'values.update header');
		}
	}
}

export async function upsertWallet({ discordId, discordUsername, wallet, tier, roleName }) {
	await ensureSheetSetup();
	const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID;
	
	const targetSheet = getSheetNameForTier(tier);
	if (!targetSheet) {
		return { action: 'skipped', reason: 'invalid_tier' };
	}
	
	// Check ONLY the target sheet to see if user already has an entry there
	// This allows stacking (same user in multiple sheets with different wallets)
	const targetRange = `${targetSheet}!A2:D`;
	const resp = await callWithRetry(() => sheetsApi.spreadsheets.values.get({ 
		spreadsheetId, 
		range: targetRange 
	}), 'values.get check target');
	const rows = resp.data.values || [];
	
	let existingRowInTarget = null;
	for (let i = 0; i < rows.length; i++) {
		if (rows[i][1] === discordId) {
			existingRowInTarget = i + 2; // actual row number
			break;
		}
	}
	
	if (existingRowInTarget) {
		// Update existing row in target sheet
		const updateRange = `${targetSheet}!A${existingRowInTarget}:D${existingRowInTarget}`;
		await callWithRetry(() => sheetsApi.spreadsheets.values.update({
			spreadsheetId,
			range: updateRange,
			valueInputOption: 'RAW',
			requestBody: {
				values: [[discordUsername, discordId, roleName ?? '', wallet]],
			},
		}), 'values.update upsert');
		return { action: 'updated' };
	} else {
		// Insert new row in target sheet (allows stacking across sheets)
		await callWithRetry(() => sheetsApi.spreadsheets.values.append({
			spreadsheetId,
			range: targetRange,
			valueInputOption: 'RAW',
			insertDataOption: 'INSERT_ROWS',
			requestBody: {
				values: [[discordUsername, discordId, roleName ?? '', wallet]],
			},
		}), 'values.append upsert');
		return { action: 'inserted' };
	}
}

// Helper function to delete a row from a specific sheet
async function deleteRowFromSheet(sheetName, rowNumber) {
	const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID;
	const spreadsheet = await callWithRetry(() => sheetsApi.spreadsheets.get({ spreadsheetId }), 'spreadsheets.get');
	const sheet = spreadsheet.data.sheets?.find((s) => s.properties?.title === sheetName);
	if (!sheet) return;
	
	const sheetId = sheet.properties.sheetId;
	await callWithRetry(() => sheetsApi.spreadsheets.batchUpdate({
		spreadsheetId,
		requestBody: {
			requests: [{
				deleteDimension: {
					range: {
						sheetId: sheetId,
						dimension: 'ROWS',
						startIndex: rowNumber - 1,
						endIndex: rowNumber,
					},
				},
			}],
		},
	}), 'spreadsheets.batchUpdate delete row');
}

export async function getWallet(discordId) {
	await ensureSheetSetup();
	const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID;
	
	// Search across all three sheets
	for (const sheetName of Object.values(SHEET_NAMES)) {
		const range = `${sheetName}!A2:D`;
		const resp = await callWithRetry(() => sheetsApi.spreadsheets.values.get({ spreadsheetId, range }), 'values.get getWallet');
		const rows = resp.data.values || [];
		for (const row of rows) {
			if (row[1] === discordId) {
				return { discordUsername: row[0], discordId: row[1], role: row[2] ?? '', wallet: row[3] ?? '' };
			}
		}
	}
	return null;
}

// Get ALL wallet submissions for a user (supports stacking)
export async function getAllWallets(discordId) {
	await ensureSheetSetup();
	const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID;
	const wallets = [];
	
	// Search across all three sheets
	for (const sheetName of Object.values(SHEET_NAMES)) {
		const range = `${sheetName}!A2:D`;
		const resp = await callWithRetry(() => sheetsApi.spreadsheets.values.get({ spreadsheetId, range }), 'values.get getAllWallets');
		const rows = resp.data.values || [];
		for (const row of rows) {
			if (row[1] === discordId) {
				wallets.push({
					tier: sheetName,
					discordUsername: row[0],
					discordId: row[1],
					role: row[2] ?? '',
					wallet: row[3] ?? ''
				});
			}
		}
	}
	
	return wallets.length > 0 ? wallets : null;
}

export async function listWallets() {
	await ensureSheetSetup();
	const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID;
	const items = [];
	
	// Collect from all three sheets
	for (const sheetName of Object.values(SHEET_NAMES)) {
		const range = `${sheetName}!A2:D`;
		const resp = await callWithRetry(() => sheetsApi.spreadsheets.values.get({ spreadsheetId, range }), 'values.get list');
		const rows = resp.data.values || [];
		for (const row of rows) {
			if (!row || row.length === 0) continue;
			items.push({
				discordUsername: row[0] ?? '',
				discordId: row[1] ?? '',
				role: row[2] ?? '',
				wallet: row[3] ?? '',
			});
		}
	}
	return items;
}

export async function listWalletsWithRow() {
	await ensureSheetSetup();
	const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID;
	const items = [];
	
	// Collect from all three sheets with sheet info
	for (const sheetName of Object.values(SHEET_NAMES)) {
		const range = `${sheetName}!A2:D`;
		const resp = await callWithRetry(() => sheetsApi.spreadsheets.values.get({ spreadsheetId, range }), 'values.get listWithRow');
		const rows = resp.data.values || [];
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i] || [];
			if (row.length === 0) continue;
			items.push({
				sheetName: sheetName,
				rowNumber: i + 2, // actual sheet row number
				discordUsername: row[0] ?? '',
				discordId: row[1] ?? '',
				role: row[2] ?? '',
				wallet: row[3] ?? '',
			});
		}
	}
	return items;
}

export async function getStatistics() {
	await ensureSheetSetup();
	const spreadsheetId = GOOGLE_SHEETS_SPREADSHEET_ID;
	
	const stats = {
		'2GTD': { total: 0, byRole: {} },
		'1GTD': { total: 0, byRole: {} },
		'FCFS': { total: 0, byRole: {} },
	};
	
	// Collect statistics from all three sheets
	for (const sheetName of Object.values(SHEET_NAMES)) {
		const range = `${sheetName}!A2:D`;
		const resp = await callWithRetry(() => sheetsApi.spreadsheets.values.get({ spreadsheetId, range }), 'values.get statistics');
		const rows = resp.data.values || [];
		
		const tierKey = sheetName; // '2GTD', '1GTD', or 'FCFS'
		stats[tierKey].total = rows.length;
		
		// Count by role
		for (const row of rows) {
			if (!row || row.length < 3) continue;
			const roleName = row[2] ?? 'Unknown';
			
			if (!stats[tierKey].byRole[roleName]) {
				stats[tierKey].byRole[roleName] = 0;
			}
			stats[tierKey].byRole[roleName]++;
		}
	}
	
	return stats;
}




