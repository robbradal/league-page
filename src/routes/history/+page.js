import { getAssetHistory, loadPlayers, getLeagueTeamManagers } from '$lib/utils/helper';

export async function load({ url, fetch }) {
    return {
        historyData: getAssetHistory(),
        playersData: loadPlayers(fetch),
        leagueTeamManagersData: getLeagueTeamManagers(),
        asset: url?.searchParams?.get('asset') || null,
        view: url?.searchParams?.get('view') || 'moves',
    };
}
