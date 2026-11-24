import { get } from 'svelte/store';
import { assetHistoryStore } from '$lib/stores';
import { leagueID } from '$lib/utils/leagueInfo';
import { buildAssetHistory } from './assetHistoryBuilder';

export const getAssetHistory = async () => {
    const cached = get(assetHistoryStore);
    if(cached && cached.assets) return cached;
    const history = await buildAssetHistory(leagueID, fetch);
    assetHistoryStore.set(history);
    return history;
}
